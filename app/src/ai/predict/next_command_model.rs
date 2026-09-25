use std::sync::Arc;

use chrono::Utc;
use futures::stream::AbortHandle;
use itertools::Itertools;
#[cfg_attr(not(feature = "local_fs"), allow(unused_imports))]
use parking_lot::{FairMutex, Mutex};
use warp_completer::completer::{
    self, CompleterOptions, CompletionsFallbackStrategy, MatchStrategy,
};
use warpui::{Entity, ModelContext, ModelHandle, SingletonEntity};

use super::generate_ai_input_suggestions::{
    GenerateAIInputSuggestionsRequest, GenerateAIInputSuggestionsResponseV2, NextCommandContext,
    create_generate_ai_input_suggestions_request, get_context_messages,
};
use crate::ai::block_context::BlockContext;
use crate::ai::blocklist::BlocklistAIController;
use crate::ai_assistant::execution_context::WarpAiExecutionContext;
#[cfg(feature = "local_fs")]
use crate::doomterm::history_autosuggestions::get_similar_history_context;
use crate::doomterm::history_autosuggestions::{
    get_reverse_chronological_potential_autosuggestions, is_command_valid,
};
#[cfg(feature = "local_fs")]
use crate::persistence::{database_file_path_for_current_scope, establish_ro_connection};
use crate::server::server_api::{AIApiError, ServerApi};
use crate::server::team_scope::RequestTeamScope;
use crate::settings::AISettings;
use crate::terminal::TerminalModel;
use crate::terminal::event::UserBlockCompleted;
use crate::terminal::input::{CompleterData, IntelligentAutosuggestionResult};
use crate::terminal::model::session::Sessions;
use crate::workspaces::user_workspaces::UserWorkspaces;

cfg_if::cfg_if! {
    if #[cfg(feature = "local_fs")] {
        use diesel::SqliteConnection;
    }
}

/// The number of additional preceding commands for each HistoryContext
/// included in the LLM request.
#[cfg_attr(not(feature = "local_fs"), allow(dead_code))]
const NUM_ADDITIONAL_PREV_COMMAND_CONTEXT_LLM: usize = 2;

pub fn is_next_command_enabled(app: &warpui::AppContext) -> bool {
    AISettings::as_ref(app).is_intelligent_autosuggestions_enabled(app)
        && UserWorkspaces::as_ref(app).is_next_command_enabled()
}

/// Information about an autosuggestion that would have been made if purely based off history.
/// If there was no history, history_command_prediction would be an empty string.
#[derive(Clone, Default, PartialEq, Debug)]
pub struct HistoryBasedAutosuggestionState {
    pub history_command_prediction: String,
    pub history_command_prediction_likelihood: f64,
    pub total_history_count: usize,
}

#[derive(Clone, Default, PartialEq)]
pub enum NextCommandSuggestionState {
    #[default]
    None,
    Cycling,
    Ready {
        request: Box<GenerateAIInputSuggestionsRequest>,
        response: GenerateAIInputSuggestionsResponseV2,
        /// How long the request took to complete, in milliseconds.
        request_duration_ms: i64,
        /// If true, we made a call to an LLM to generate this.
        /// Otherwise it came from history.
        is_from_ai: bool,
        /// If true, this suggestion came from the user explicitly cycling (is not the initial suggestion).
        is_from_cycle: bool,
        history_based_autosuggestion_state: HistoryBasedAutosuggestionState,
    },
}

impl NextCommandSuggestionState {
    pub fn is_ready(&self) -> bool {
        matches!(self, NextCommandSuggestionState::Ready { .. })
    }

    pub fn is_cycling(&self) -> bool {
        matches!(self, NextCommandSuggestionState::Cycling)
    }

    pub fn command_suggestion(&self) -> Option<&str> {
        match &self {
            // The server only returns one command suggestion as the most likely action.
            NextCommandSuggestionState::Ready { response, .. } => {
                let command = &response.most_likely_action;
                // If AI accidentally returned JSON instead of a plain string for the most likely action, don't use it.
                if command.starts_with('{') {
                    return None;
                }
                Some(command)
            }
            _ => None,
        }
    }
}

/// Struct storing the result of the zero-state next command suggestion,
/// used for telemetry purposes.
#[derive(Clone)]
pub struct ZeroStateSuggestionInfo {
    pub request: Box<GenerateAIInputSuggestionsRequest>,
    pub response: GenerateAIInputSuggestionsResponseV2,
    /// How long the request took to complete, in milliseconds.
    pub request_duration_ms: i64,
    /// If true, we made a call to an LLM to generate this.
    /// Otherwise it came from history.
    pub is_from_ai: bool,
    pub history_based_autosuggestion_state: HistoryBasedAutosuggestionState,
}

pub struct NextCommandModel {
    sessions: ModelHandle<Sessions>,
    model: Arc<FairMutex<TerminalModel>>,
    server_api: Arc<ServerApi>,
    /// The window's Agent Mode controller, consulted for the team the window is scoped to
    /// so next-command requests resolve against that team rather than the server's default.
    ai_controller: ModelHandle<BlocklistAIController>,
    #[cfg(feature = "local_fs")]
    conn: Option<Arc<Mutex<SqliteConnection>>>,

    next_command_state: NextCommandSuggestionState,
    /// Context used to generate the zero-state suggestion.
    /// We reuse this but apply filtering on history_contexts as the user edits the input.
    cached_zerostate_next_command_context: Option<NextCommandContext>,
    zerostate_suggestion_info: Option<ZeroStateSuggestionInfo>,
    next_command_abort_handle: Option<AbortHandle>,
}

impl Entity for NextCommandModel {
    type Event = NextCommandModelEvent;
}

pub enum NextCommandModelEvent {
    NextCommandSuggestionReady,
}

impl NextCommandModel {
    pub fn new(
        sessions: ModelHandle<Sessions>,
        model: Arc<FairMutex<TerminalModel>>,
        server_api: Arc<ServerApi>,
        ai_controller: ModelHandle<BlocklistAIController>,
    ) -> Self {
        #[cfg(feature = "local_fs")]
        let conn = database_file_path_for_current_scope()
            .to_str()
            .and_then(|db_url| {
                establish_ro_connection(db_url)
                    .ok()
                    .map(|conn| Arc::new(Mutex::new(conn)))
            });
        Self {
            sessions,
            model,
            server_api,
            ai_controller,
            #[cfg(feature = "local_fs")]
            conn,
            next_command_state: NextCommandSuggestionState::None,
            cached_zerostate_next_command_context: None,
            zerostate_suggestion_info: None,
            next_command_abort_handle: None,
        }
    }

    pub fn get_state(&self) -> &NextCommandSuggestionState {
        &self.next_command_state
    }

    pub fn get_zero_state_suggestion_info(&self) -> Option<&ZeroStateSuggestionInfo> {
        self.zerostate_suggestion_info.as_ref()
    }

    pub fn clear_state(&mut self) {
        self.next_command_state = NextCommandSuggestionState::None;
        self.cached_zerostate_next_command_context = None;
        self.zerostate_suggestion_info = None;
        self.abort_inflight_request();
    }

    pub fn abort_inflight_request(&mut self) {
        if let Some(abort_handle) = self.next_command_abort_handle.take() {
            abort_handle.abort();
        }
    }

    pub fn cycle_next_command_suggestion(&mut self, _ctx: &mut ModelContext<Self>) {
        // TODO(roland): reconsider down arrow UX for next command or remove completely
    }

    #[cfg_attr(not(feature = "local_fs"), allow(unused_variables))]
    fn get_next_command_context(
        terminal_model: Arc<FairMutex<TerminalModel>>,
        #[cfg(feature = "local_fs")] conn: Option<Arc<Mutex<SqliteConnection>>>,
        ai_execution_context: WarpAiExecutionContext,
        block_completed: &UserBlockCompleted,
    ) -> NextCommandContext {
        #[cfg_attr(not(feature = "local_fs"), allow(unused_mut))]
        let mut history_contexts = vec![];
        let context_messages = get_context_messages(terminal_model.clone(), 5, 100, 200);
        #[cfg(feature = "local_fs")]
        if let Some(conn) = conn {
            let mut conn = conn.lock();
            let serialized_block = block_completed.serialized_block.get_with(|compute| {
                let model = terminal_model.lock();
                compute(model.block_list())
            });
            let command = block_completed.command.get_with(|compute| {
                let model = terminal_model.lock();
                compute(model.block_list())
            });
            history_contexts = get_similar_history_context(
                &mut conn,
                command,
                &serialized_block.pwd,
                serialized_block.exit_code,
                serialized_block.shell_host.as_ref(),
                NUM_ADDITIONAL_PREV_COMMAND_CONTEXT_LLM,
            );
        }
        NextCommandContext {
            history_contexts,
            ai_execution_context,
            context_messages,
        }
    }

    /// Generates a zero-state next command suggestion immediately after a block completes.
    pub fn generate_next_command_suggestion(
        &mut self,
        block_completed: UserBlockCompleted,
        context: WarpAiExecutionContext,
        completer_data: CompleterData,
        block_context: Option<Box<BlockContext>>,
        previous_result: Option<IntelligentAutosuggestionResult>,
        ctx: &mut ModelContext<Self>,
    ) {
        // Clear the cached next command context so we don't use stale data.
        self.cached_zerostate_next_command_context = None;
        self.zerostate_suggestion_info = None;
        self.generate_next_command_suggestion_with_prefix(
            None,
            block_completed,
            context,
            completer_data,
            block_context,
            previous_result,
            ctx,
        );
    }

    /// Generates a next command suggestion with a prefix in the input.
    #[cfg_attr(not(feature = "local_fs"), allow(unused_variables))]
    #[expect(clippy::too_many_arguments)]
    pub fn generate_next_command_suggestion_with_prefix(
        &mut self,
        prefix: Option<String>,
        block_completed: UserBlockCompleted,
        context: WarpAiExecutionContext,
        completer_data: CompleterData,
        block_context: Option<Box<BlockContext>>,
        previous_result: Option<IntelligentAutosuggestionResult>,
        ctx: &mut ModelContext<Self>,
    ) {
        let server_api = self.server_api.clone();
        let terminal_model = self.model.clone();
        let cached_next_command_context = self.cached_zerostate_next_command_context.clone();
        let team_scope =
            RequestTeamScope::from_scope(&self.ai_controller.as_ref(ctx).team_context(ctx));

        let completion_context = completer_data.completion_session_context(ctx);
        // This is only needed if we have a prefix.
        let reverse_chronological_potential_autosuggestions = if let Some(prefix) = &prefix {
            get_reverse_chronological_potential_autosuggestions(prefix, &completer_data, ctx)
        } else {
            None
        };

        #[cfg(feature = "local_fs")]
        let conn = self.conn.clone();
        self.next_command_state = NextCommandSuggestionState::None;
        self.abort_inflight_request();
        let session_env_vars = completer_data
            .active_block_session_id()
            .and_then(|session_id| {
                self.sessions.read(ctx, |sessions, _| {
                    sessions.get_env_vars_for_session(session_id)
                })
            });
        self.next_command_abort_handle = Some(
            ctx.spawn(
                async move {
                    let mut history_based_autosuggestion_state =
                        HistoryBasedAutosuggestionState::default();
                    let start_ts_ms = Utc::now().timestamp_millis();

                    let mut next_command_context =
                        if let Some(cached_next_command_context) = cached_next_command_context {
                            cached_next_command_context
                        } else {
                            Self::get_next_command_context(
                                terminal_model,
                                #[cfg(feature = "local_fs")]
                                conn,
                                context,
                                &block_completed,
                            )
                        };
                    // Filter history contexts for only cases where the next command matches our prefix.
                    if let Some(prefix) = &prefix {
                        next_command_context.history_contexts = next_command_context
                            .history_contexts
                            .into_iter()
                            .filter(|context| context.next_command.command.starts_with(prefix))
                            .collect_vec();
                    }
                    // First, use rich history to find commands with a matching prefix that were run
                    // in a similar context, taking into account the most recent block run.
                    if !next_command_context.history_contexts.is_empty() {
                        let mut history_next_command_counts = counter::Counter::new();
                        for history_context in &next_command_context.history_contexts {
                            history_next_command_counts[&history_context.next_command.command] += 1;
                        }

                        let mut total_history_count = history_next_command_counts.total::<usize>();
                        let most_likely_next_commands =
                            history_next_command_counts.k_most_common_ordered(5);
                        for (most_likely_next_command, count) in &most_likely_next_commands {
                            if !is_command_valid(most_likely_next_command, completion_context.as_ref(), session_env_vars.as_ref()).await {
                                log::debug!("Discarding most likely next command from rich history that failed validation: `{most_likely_next_command}`");
                                total_history_count -= *count;
                                continue;
                            }
                            let history_command_prediction_likelihood =
                                *count as f64 / total_history_count as f64;
                            history_based_autosuggestion_state = HistoryBasedAutosuggestionState {
                                history_command_prediction: most_likely_next_command.to_owned(),
                                history_command_prediction_likelihood,
                                total_history_count,
                            };

                            // If one command is very likely based on history, skip the LLM call and return it directly.
                            // Use history-based autosuggestion if there are a min number of similar cases in history
                            // AND the same command was run at least skip_llm_confidence_threshold of the time.
                            // Partial autosuggestions with a prefix have more lenient requirements
                            // because latency matters more as the user is typing.
                            let (min_history_count, skip_llm_confidence_threshold) =
                                if prefix.is_some() {
                                    (1, 0.1)
                                } else {
                                    (2, 0.25)
                                };
                            if total_history_count >= min_history_count
                                && history_command_prediction_likelihood
                                    >= skip_llm_confidence_threshold
                            {
                                // We construct the request even though we're not sending it to the server because
                                // it might be used later for cycling next command suggestions.
                                let request = create_generate_ai_input_suggestions_request(
                                    next_command_context.clone(),
                                    prefix,
                                    block_context,
                                    previous_result,
                                );
                                return (
                                    Ok(GenerateAIInputSuggestionsResponseV2 {
                                        commands: vec![most_likely_next_command.to_owned()],
                                        ai_queries: vec![],
                                        most_likely_action: most_likely_next_command.to_owned(),
                                    }),
                                    request,
                                    false,
                                    start_ts_ms,
                                    history_based_autosuggestion_state,
                                    false,
                                    next_command_context,
                                );
                            }
                        }
                    }
                    let request = create_generate_ai_input_suggestions_request(
                        next_command_context.clone(),
                        prefix.clone(),
                        block_context,
                        previous_result,
                    );

                    // For zero-state next command suggestions, return the result immediately.
                    let Some(prefix) = prefix else {
                        return (
                            server_api
                                .generate_ai_input_suggestions(&request, team_scope)
                                .await,
                            request,
                            true,
                            start_ts_ms,
                            history_based_autosuggestion_state,
                            false,
                            next_command_context,
                        );
                    };

                    // At this point we know we're generating a partial suggestion with a prefix.
                    // First, return the most recent command with a matching prefix run in the same pwd
                    // (if exists, otherwise just most recent command anywhere with matching prefix).
                    for reverse_chronological_command in reverse_chronological_potential_autosuggestions.unwrap_or_default() {
                        if is_command_valid(&reverse_chronological_command.command, completion_context.as_ref(), session_env_vars.as_ref()).await {
                            return (
                                Ok(GenerateAIInputSuggestionsResponseV2 {
                                    commands: vec![reverse_chronological_command.command.clone()],
                                ai_queries: vec![],
                                most_likely_action: reverse_chronological_command.command,
                            }),
                            request,
                            false,
                            start_ts_ms,
                                history_based_autosuggestion_state,
                                false,
                                next_command_context,
                            );
                        }
                    }

                    // If we have no command anywhere in history with a matching prefix, fallback to the first completer result.
                    if let Some(completion_context) = completion_context {
                        let completion_result = completer::suggestions(
                            &prefix,
                            prefix.len(),
                            session_env_vars.as_ref(),
                            CompleterOptions {
                                match_strategy: MatchStrategy::CaseSensitive,
                                fallback_strategy: CompletionsFallbackStrategy::None,
                                suggest_file_path_completions_only: false,
                                parse_quotes_as_literals: false,
                            },
                            &completion_context,
                        )
                        .await;

                        let autosuggestion = completion_result.and_then(|result| {
                            let replacement_span = result.replacement_span;
                            result.suggestions.into_iter().next().map(|s| {
                                // Reproduce the final buffer text with the autosuggestion since the
                                // completer only gives the replacement span of the suggestion.
                                let result = format!(
                                    "{}{}",
                                    &prefix[0..replacement_span.start()],
                                    s.replacement()
                                );
                                result
                            })
                        });

                        if let Some(autosuggestion) = autosuggestion
                            && is_command_valid(&autosuggestion, Some(&completion_context), session_env_vars.as_ref()).await {
                                return (
                                    Ok(GenerateAIInputSuggestionsResponseV2 {
                                        commands: vec![autosuggestion.clone()],
                                    ai_queries: vec![],
                                    most_likely_action: autosuggestion,
                                }),
                                request,
                                false,
                                    start_ts_ms,
                                    history_based_autosuggestion_state,
                                    false,
                                    next_command_context,
                                );
                            }
                    };

                    // Only if we have no commands from history and no completions, use the LLM to generate a partial suggestion.
                    let response = server_api
                        .generate_ai_input_suggestions(&request, team_scope)
                        .await;
                    (
                        response,
                        request,
                        true,
                        start_ts_ms,
                        history_based_autosuggestion_state,
                        false,
                        next_command_context,
                    )
                },
                Self::on_next_command_suggestion_result,
            )
            .abort_handle(),
        );
    }

    fn on_next_command_suggestion_result(
        &mut self,
        result: (
            Result<GenerateAIInputSuggestionsResponseV2, AIApiError>,
            GenerateAIInputSuggestionsRequest,
            bool,
            i64,
            HistoryBasedAutosuggestionState,
            bool,
            NextCommandContext,
        ),
        ctx: &mut ModelContext<Self>,
    ) {
        self.next_command_abort_handle = None;
        let (
            result,
            request,
            is_from_ai,
            start_ts_ms,
            history_based_autosuggestion_state,
            is_from_cycle,
            next_command_context,
        ) = result;
        let end_ts_ms = Utc::now().timestamp_millis();
        let request_duration_ms = end_ts_ms - start_ts_ms;
        if request.prefix.is_none() {
            self.cached_zerostate_next_command_context = Some(next_command_context);
        }
        match result {
            Ok(response) => {
                if let Some(prefix) = &request.prefix {
                    if !response.most_likely_action.starts_with(prefix) {
                        // This is not expected to happen because the server applies its own filtering,
                        // but check just in case.
                        log::warn!(
                            "Next command suggestion `{}` does not start with prefix `{}`.",
                            response.most_likely_action,
                            prefix
                        );
                        return;
                    }
                } else {
                    self.zerostate_suggestion_info = Some(ZeroStateSuggestionInfo {
                        request: Box::new(request.clone()),
                        response: response.clone(),
                        request_duration_ms,
                        is_from_ai,
                        history_based_autosuggestion_state: history_based_autosuggestion_state
                            .clone(),
                    });
                }

                self.next_command_state = NextCommandSuggestionState::Ready {
                    request: Box::new(request),
                    response,
                    request_duration_ms,
                    is_from_ai,
                    is_from_cycle,
                    history_based_autosuggestion_state,
                };
                ctx.emit(NextCommandModelEvent::NextCommandSuggestionReady);
            }
            Err(err) => {
                log::error!("Failed to generate Next Command suggestion: {err:#}");
            }
        };
    }
}

impl SingletonEntity for NextCommandModel {}
