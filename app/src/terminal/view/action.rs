use std::fmt;
use std::ops::Range;
use std::path::PathBuf;

#[cfg(feature = "warp_services")]
use ai::skills::SkillReference;
use command_corrections::Correction;
#[cfg(feature = "warp_services")]
pub use onboarding::OnboardingIntention;
use pathfinder_geometry::vector::Vector2F;
#[cfg(feature = "warp_services")]
use session_sharing_protocol::common::Role;
#[cfg(feature = "warp_services")]
use session_sharing_protocol::sharer::RoleUpdateReason;
use warp_util::user_input::UserInput;
#[cfg(feature = "warp_services")]
use warpui::EntityId;
use warpui::elements::HyperlinkUrl;
use warpui::event::ModifiersState;
use warpui::units::Lines;

#[cfg(feature = "warp_services")]
use super::inline_banner::AwsBedrockLoginBannerAction;
#[cfg(feature = "warp_services")]
use super::inline_banner::AwsCliNotInstalledBannerAction;
use super::inline_banner::{OpenInWarpBannerAction, VimModeBannerAction};
use super::{
    AliasExpansionBannerAction, ContextMenuAction, GridHighlightedLink, InputContextMenuAction,
    NotificationsDiscoveryBannerAction, NotificationsErrorBannerAction, RichContentLink,
    TerminalEditor,
};
#[cfg(feature = "warp_services")]
use crate::ai::agent::AIAgentExchangeId;
#[cfg(feature = "warp_services")]
use crate::ai::agent::conversation::AIConversationId;
#[cfg(feature = "warp_services")]
use crate::ai::blocklist::agent_view::AgentViewEntryOrigin;
#[cfg(feature = "warp_services")]
use crate::ai::blocklist::codebase_index_speedbump_banner::CodebaseIndexSpeedbumpBannerAction;
#[cfg(feature = "warp_services")]
use crate::code_review::telemetry_event::CodeReviewPaneEntrypoint;
#[cfg(feature = "warp_services")]
use crate::server::ids::SyncId;
#[cfg(feature = "warp_services")]
use crate::server::telemetry::AgentModeRewindEntrypoint;
use crate::server::telemetry::{PaletteSource, ToggleBlockFilterSource};
use crate::terminal::available_shells::AvailableShell;
use crate::terminal::block_list_element::{
    BlockHoverAction, BlockListMenuSource, BlockSelectAction, BlockTextSelectAction,
};
use crate::terminal::block_list_viewport::OverhangingBlock;
use crate::terminal::model::SecretHandle;
use crate::terminal::model::completions::ShellCompletion;
use crate::terminal::model::index::Point;
use crate::terminal::model::mouse::MouseState;
use crate::terminal::model::selection::{SelectAction, SelectionDirection};
use crate::terminal::model::terminal_model::{BlockIndex, WithinModel};
#[cfg(feature = "warp_services")]
use crate::terminal::shared_session::SharedSessionActionSource;
use crate::terminal::view::RichContentSecretTooltipInfo;
#[cfg(feature = "warp_services")]
use crate::terminal::view::inline_banner::AgentModeSetupSpeedbumpBannerAction;
#[cfg(feature = "warp_services")]
use crate::terminal::view::passive_suggestions::PromptSuggestionResolution;
#[cfg(feature = "warp_services")]
use crate::workflows::workflow::Workflow;

/// Version of the agent onboarding flow (non-legacy).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentOnboardingVersion {
    UniversalInput {
        has_project: bool,
    },
    AgentModality {
        has_project: bool,
        #[cfg(feature = "warp_services")]
        intention: OnboardingIntention,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnboardingVersion {
    Agent(AgentOnboardingVersion),
}

/// This represents whether entering a subshell for a particular command should become automatic in
/// the future, or to ask again.
#[derive(Clone, Debug)]
pub enum RememberForWarpification {
    /// If yes, need to transmit the command itself so it can be persisted to user-defaults
    RememberSubshellCommand(String),
    RememberSSHHost(String),
    DoNotRememberSubshellCommand,
    DoNotRememberSSHHost,
}

impl RememberForWarpification {
    pub fn as_bool(&self) -> bool {
        match self {
            RememberForWarpification::RememberSubshellCommand(_) => true,
            RememberForWarpification::RememberSSHHost(_) => true,
            RememberForWarpification::DoNotRememberSubshellCommand => false,
            RememberForWarpification::DoNotRememberSSHHost => false,
        }
    }

    pub fn is_ssh(&self) -> bool {
        match self {
            RememberForWarpification::RememberSSHHost(_) => true,
            RememberForWarpification::DoNotRememberSSHHost => true,
            RememberForWarpification::RememberSubshellCommand(_) => false,
            RememberForWarpification::DoNotRememberSubshellCommand => false,
        }
    }
}

#[derive(Clone)]
pub enum TerminalAction {
    Scroll {
        delta: Lines,
    },
    AltScroll {
        delta: i32,
        point: Point,
    },
    #[cfg(feature = "warp_services")]
    SharedSessionViewerAltScroll {
        new_scroll_top: Lines,
    },
    ScrollToTopOfBlock {
        topmost_block: BlockIndex,
    },
    BlockTextSelect(BlockTextSelectAction),
    BlockSelect {
        action: BlockSelectAction,
        should_redetermine_focus: bool,
    },
    BlockHover(BlockHoverAction),
    BlockSnackbarHover {
        is_hovered: bool,
    },
    BlockNearSnackbarHover {
        is_hovered: bool,
    },

    // TODO: we should eventually use a Modifiers struct here instead of using
    // an aggregated is_selecting_blocks when we need better granularity.
    // This refactor will need to start from the Events themselves.
    ClickOnGrid {
        position: WithinModel<Point>,
        modifiers: ModifiersState,
    },
    MiddleClickOnGrid {
        /// `None` here means that the click was on the Block List but not on a particular blockgrid.
        position: Option<WithinModel<Point>>,
    },
    MiddleClickOnInput,
    MaybeLinkHover {
        position: Option<WithinModel<Point>>,
        from_editor: TerminalEditor,
    },
    MaybeHoverSecret {
        secret_handle: Option<SecretHandle>,
    },
    MaybeDismissToolTip {
        from_keybinding: bool,
    },
    AltScreenContextMenu {
        position: Vector2F,
    },
    AltSelect(SelectAction<Point>),
    MaybeClearAltSelect,
    AltMouseAction(MouseState),
    InsertCommandCorrection {
        correction: Correction,
    },
    BlockListContextMenu(BlockListMenuSource),
    CloseContextMenu,
    Paste,
    Copy,
    CopyOutputs,
    CopyCommands,
    CopyGitBranch,
    #[cfg(feature = "warp_services")]
    OpenShareModal,
    ReinputCommands,
    ReinputCommandsWithSudo,
    ClearBuffer,
    Focus,
    FocusInputAndClearSelection,
    ShowFindBar,
    SelectPriorBlock,
    SelectBookmarkDown,
    SelectBookmarkUp,
    #[cfg(feature = "warp_services")]
    JumpToLatestAgentMessage,
    BookmarkSelectedBlock,
    ScrollToBottomOfSelectedBlocks,
    ScrollToTopOfSelectedBlocks,
    ScrollToBottomOfOverhangingBlock(OverhangingBlock),
    SelectNextBlock,
    Up,
    OpenBlockListContextMenu,
    Down,
    PageUp,
    PageDown,
    Home,
    End,
    KeyboardSelectText(SelectionDirection),
    UserInputSequence(Vec<u8>),
    ControlSequence(Vec<u8>),
    RunNativeShellCompletions {
        buffer_text: String,
        results_tx:
            async_channel::Sender<(Vec<ShellCompletion>, Option<warp_completer::meta::Span>)>,
    },
    KeyDown(String),
    TypedCharacters(String),
    ContextMenu(ContextMenuAction),
    // IMPORTANT: Do not add a binding for ctrl_d, as we don't want this behavior to leak out to
    // parts of the terminal unrelated to the block list
    CtrlD,
    CtrlC,
    ClearSelectionsWhenShellMode,
    Close,
    ToggleMaximizePane,
    SplitRight(Option<AvailableShell>),
    SplitLeft(Option<AvailableShell>),
    SplitDown(Option<AvailableShell>),
    SplitUp(Option<AvailableShell>),
    /// The context menu that's used for the prompt directly above input editor
    PromptContextMenu {
        position_offset_from_prompt: Vector2F,
    },
    OpenInputContextMenu {
        position: Vector2F,
    },
    InputContextMenuItem(InputContextMenuAction),
    /// Open the menu on the specified [`crate::ai::blocklist::AIBlock`] that lists the blocks that
    /// were attached to the query in the specified [`crate::ai::blocklist::AIAgentExchange`] which
    /// is part of the specified [`crate::ai::blocklist::AIConversation`].
    #[cfg(feature = "warp_services")]
    OpenAIBlockAttachedBlocksMenu {
        ai_block_view_id: EntityId,
        exchange_id: AIAgentExchangeId,
        conversation_id: AIConversationId,
    },
    /// Open the overflow context menu for an AI block with copy options
    #[cfg(feature = "warp_services")]
    OpenAIBlockOverflowMenu {
        ai_block_view_id: EntityId,
        exchange_id: AIAgentExchangeId,
        conversation_id: AIConversationId,
        is_restored: bool,
    },
    /// Show the confirmation dialog before rewinding an AI conversation
    #[cfg(feature = "warp_services")]
    RewindAIConversation {
        ai_block_view_id: EntityId,
        exchange_id: AIAgentExchangeId,
        conversation_id: AIConversationId,
        /// The entrypoint from which this action was triggered (for telemetry).
        entrypoint: AgentModeRewindEntrypoint,
    },
    /// Actually execute the rewind (called after user confirms in the dialog)
    #[cfg(feature = "warp_services")]
    ExecuteRewindAIConversation {
        ai_block_view_id: EntityId,
        exchange_id: AIAgentExchangeId,
        conversation_id: AIConversationId,
    },
    /// Execute rewind from the inline menu (looks up ai_block_view_id from exchange_id)
    #[cfg(feature = "warp_services")]
    ExecuteRewindFromInlineMenu {
        exchange_id: AIAgentExchangeId,
        conversation_id: AIConversationId,
    },
    SelectAllBlocks,
    ExpandBlockSelectionAbove,
    ExpandBlockSelectionBelow,
    NotificationsDiscoveryBanner(NotificationsDiscoveryBannerAction),
    BookmarkBlock(BlockIndex),
    NotificationsErrorBanner(NotificationsErrorBannerAction),
    JumpToBookmark(BlockIndex),
    OpenGridLink(GridHighlightedLink),
    OpenRichContentLink(RichContentLink),
    ToggleGridSecret {
        handle: WithinModel<SecretHandle>,
        show_secret: bool,
    },
    CopyGridSecret(WithinModel<SecretHandle>),
    ToggleRichContentSecret {
        rich_content_tooltip_info: RichContentSecretTooltipInfo,
        show_secret: bool,
    },
    CopyRichContentSecret(RichContentSecretTooltipInfo),
    ShowInFileExplorer(PathBuf),
    OpenFileInWarp(PathBuf),
    #[cfg(feature = "local_fs")]
    OpenCodeInWarp {
        path: PathBuf,
        layout: crate::util::file::external_editor::settings::EditorLayout,
        line_col: Option<warp_util::path::LineAndColumnArg>,
    },
    #[cfg(feature = "warp_services")]
    OpenWorkflowModal,
    #[cfg(feature = "warp_services")]
    OpenWorkflowModalForAIWorkflow(Workflow),
    #[cfg(feature = "warp_services")]
    OpenWorkflowModalForBlock(BlockIndex),
    #[cfg(feature = "warp_services")]
    OpenWorkflowModalWithCloudWorkflow(SyncId),
    #[cfg(feature = "warp_services")]
    AskAIAssistant {
        block_index: BlockIndex,
    },
    /// Starts a subshell in the active session.
    TriggerSubshellBootstrap,
    /// If the user says "no" to Warpification, possibly requesting not to be asked again
    DismissWarpifyBanner(RememberForWarpification),
    /// Triggers the banner asking to turn the running block into a subshell. The String is the
    /// command that the user entered.
    ShowSubshellBanner(String),
    InsertMostRecentCommandCorrection,
    AliasExpansionBanner(AliasExpansionBannerAction),
    OpenInWarpBanner(OpenInWarpBannerAction),
    OpenBlockFilterEditor(BlockIndex),
    #[cfg(feature = "warp_services")]
    OnboardingFlow(OnboardingVersion),
    ImportSettings,
    #[cfg(feature = "warp_services")]
    StopSharingCurrentSession {
        source: SharedSessionActionSource,
    },
    #[cfg(feature = "warp_services")]
    OpenSharedSessionOnDesktop {
        source: SharedSessionActionSource,
    },
    ToggleBlockFilterOnSelectedOrLastBlock(ToggleBlockFilterSource),
    #[cfg(feature = "warp_services")]
    OpenShareSessionModal {
        source: SharedSessionActionSource,
    },
    #[cfg(feature = "warp_services")]
    CopySharedSessionLink {
        source: SharedSessionActionSource,
    },
    VimModeBanner(VimModeBannerAction),
    ToggleSnackbarInActivePane,
    #[cfg(feature = "warp_services")]
    MakeAllParticipantsReaders {
        reason: RoleUpdateReason,
    },
    #[cfg(feature = "warp_services")]
    OpenSharedSessionViewerRoleMenu,
    #[cfg(feature = "warp_services")]
    RequestSharedSessionRole(Role),
    /// User selected a block inside an AI block's attached block menu so we jump to it and select
    /// it if possible.
    #[cfg(feature = "warp_services")]
    SelectAIAttachedBlock(BlockIndex),
    DragAndDropFiles(Vec<String>),
    /// Sets the input mode to Agent Mode
    #[cfg(feature = "warp_services")]
    SetInputModeAgent,
    /// Sets the input mode to Terminal Mode
    #[cfg(feature = "warp_services")]
    SetInputModeTerminal,
    /// Toggle voice input for CLI agent footer (dispatched from alt screen/blocklist when footer is visible)
    #[cfg(feature = "warp_services")]
    #[cfg(feature = "voice_input")]
    ToggleCLIAgentVoiceInput(voice_input::VoiceInputToggledFrom),

    HyperlinkClick(HyperlinkUrl),
    #[cfg(feature = "warp_services")]
    AttemptLoginGatedFeature,
    StartFileDropTarget,
    StopFileDropTarget,
    #[cfg(feature = "warp_services")]
    OpenTeamSettingsPage,
    SetMarkedText {
        marked_text: UserInput<String>,
        selected_range: Range<usize>,
    },
    ClearMarkedText,
    #[cfg(feature = "warp_services")]
    HideTelemetryBannerPermanently,
    ShowInitializationBlock,
    #[cfg(feature = "warp_services")]
    GenerateCodebaseIndex,
    /// This is for debugging, dev only for now
    #[cfg(feature = "warp_services")]
    LoadAgentModeConversation,
    ShowWarpifySettings,
    /// Removes a pending attachment (image or file) by index in the unified list.
    #[cfg(feature = "warp_services")]
    DeleteAttachment {
        index: usize,
    },
    /// Opens a pending input attachment image in the workspace lightbox before
    /// the attachment has been submitted with a user query.
    #[cfg(feature = "warp_services")]
    OpenAttachmentLightbox {
        index: usize,
    },
    #[cfg(feature = "warp_services")]
    WriteCodebaseIndex,
    #[cfg(feature = "warp_services")]
    AttachFile,
    #[cfg(feature = "warp_services")]
    ToggleAutoexecuteMode,
    #[cfg(feature = "warp_services")]
    ToggleQueueNextPrompt,
    #[cfg(feature = "warp_services")]
    CodebaseIndexSpeedbumpBanner(CodebaseIndexSpeedbumpBannerAction),
    #[cfg(feature = "warp_services")]
    AgentModeSetupSpeedbumpBanner(AgentModeSetupSpeedbumpBannerAction),
    #[cfg(feature = "warp_services")]
    ResumeConversation,
    #[cfg(feature = "warp_services")]
    ForkConversationFromLastKnownGoodState,
    #[cfg(feature = "warp_services")]
    ToggleAIDocumentPane,
    #[cfg(feature = "warp_services")]
    ToggleTodoPopup,
    #[cfg(feature = "warp_services")]
    CloseTodoPopup,
    #[cfg(feature = "warp_services")]
    ToggleCodeReviewPane {
        entrypoint: CodeReviewPaneEntrypoint,
    },
    #[cfg(feature = "warp_services")]
    InitProject,
    #[cfg(feature = "warp_services")]
    SummarizeConversation,
    #[cfg(feature = "warp_services")]
    IndexProjectSpeedbump,
    AddProjectAtCurrentDirectory,
    #[cfg(feature = "warp_services")]
    OpenProjectRulesPane,
    #[cfg(feature = "warp_services")]
    OpenViewMCPPane,
    #[cfg(feature = "warp_services")]
    OpenAddMCPPane,
    #[cfg(feature = "warp_services")]
    OpenAddRulePane,
    #[cfg(feature = "warp_services")]
    OpenRulesPane,
    #[cfg(feature = "warp_services")]
    OpenEditSkillPane {
        skill_reference: SkillReference,
    },
    #[cfg(feature = "warp_services")]
    OpenAddPromptPane,
    #[cfg(feature = "warp_services")]
    OpenBillingAndUsagePane,
    #[cfg(feature = "warp_services")]
    OpenConversationsPalette,
    PickRepoToOpen,
    OpenFilesPalette {
        source: PaletteSource,
    },
    DismissCodeToolbeltTooltip,
    /// Start a Language Server for the current working directory (if supported)
    StartLspServer,
    /// Start the guided Warp Environment setup flow (inserts the inline setup block).
    #[cfg(feature = "warp_services")]
    SetupCloudEnvironment(Vec<String>),
    /// Start the guided Warp Environment setup flow immediately (no inline setup block).
    #[cfg(feature = "warp_services")]
    SetupCloudEnvironmentAndStart(Vec<String>),
    /// Show the environment setup mode selector to choose between remote GitHub or local agent flow.
    #[cfg(feature = "warp_services")]
    TriggerEnvironmentSetupSelection(Vec<String>),
    /// Open the Environment Management pane.
    #[cfg(feature = "warp_services")]
    OpenEnvironmentManagementPane,
    #[cfg(feature = "warp_services")]
    ToggleLongRunningCommandControl,
    #[cfg(feature = "warp_services")]
    ToggleHideCliResponses,
    #[cfg(feature = "warp_services")]
    ExitAgentView,
    #[cfg(feature = "warp_services")]
    EnterCloudAgentView,
    #[cfg(feature = "warp_services")]
    StartNewAgentConversation {
        origin: AgentViewEntryOrigin,
    },
    /// Toggle the cloud mode conversation details panel
    #[cfg(feature = "warp_services")]
    ToggleConversationDetailsPanel,
    /// Cancel the ambient agent task while it's loading
    #[cfg(feature = "warp_services")]
    CancelAmbientAgentTask,
    #[cfg(feature = "warp_services")]
    OpenInlineHistoryMenu,
    #[cfg(feature = "warp_services")]
    OpenModelSelector,
    #[cfg(feature = "warp_services")]
    ResolvePromptSuggestion(PromptSuggestionResolution),
    #[cfg(feature = "warp_services")]
    AwsBedrockLoginBanner(AwsBedrockLoginBannerAction),
    #[cfg(feature = "warp_services")]
    AwsCliNotInstalledBanner(AwsCliNotInstalledBannerAction),
    /// Toggle the usage footer on the last AI block in the active conversation.
    #[cfg(feature = "warp_services")]
    ToggleUsageFooter,
    /// Reveal a hidden child agent pane from the orchestrator status card.
    #[cfg(feature = "warp_services")]
    RevealChildAgent {
        conversation_id: AIConversationId,
    },
    /// Switch the active terminal view's agent view to display the given
    /// conversation in place, without spawning or revealing a separate pane.
    /// Used by the orchestration pill bar to navigate the current pane to a
    /// sibling/parent conversation.
    #[cfg(feature = "warp_services")]
    SwitchAgentViewToConversation {
        conversation_id: AIConversationId,
    },
    /// Open a child agent conversation in a separate pane (split off from
    /// the orchestrator). Dispatched from the orchestration pill bar's
    /// 3-dot overflow menu ("Open in new pane"). For child agents that have
    /// a hidden pane in `child_agent_panes` this reveals the existing pane;
    /// for already-visible panes it focuses the existing pane.
    #[cfg(feature = "warp_services")]
    OpenChildAgentInNewPane {
        conversation_id: AIConversationId,
    },
    /// Open a child agent conversation in a separate tab. V2-of-V2 stub:
    /// dispatched from the orchestration pill bar's 3-dot overflow menu
    /// ("Open in new tab"). For now this falls back to the same path as
    /// `OpenChildAgentInNewPane` until tab-level routing is wired through.
    #[cfg(feature = "warp_services")]
    OpenChildAgentInNewTab {
        conversation_id: AIConversationId,
    },
    /// Stop a child agent conversation: cancel the in-flight ambient task
    /// (if any) and the local conversation's controller. The conversation
    /// itself stays alive so the user can still navigate to it. Dispatched
    /// from the orchestration pill bar's 3-dot overflow menu ("Stop agent").
    #[cfg(feature = "warp_services")]
    StopAgentConversation {
        conversation_id: AIConversationId,
    },
    /// Kill a child agent conversation: stop it if running, best-effort cancel
    /// any backing cloud task, then remove the conversation from local history.
    /// Dispatched from the orchestration pill bar's 3-dot overflow menu
    /// ("Kill agent").
    #[cfg(feature = "warp_services")]
    KillAgentConversation {
        conversation_id: AIConversationId,
    },
    /// Navigate to the previous child agent conversation in the active
    /// orchestration tree.
    #[cfg(feature = "warp_services")]
    CyclePreviousOrchestrationChildAgent,
    /// Navigate to the next child agent conversation in the active
    /// orchestration tree.
    #[cfg(feature = "warp_services")]
    CycleNextOrchestrationChildAgent,
    /// Toggle PTY recording for this session.
    ToggleSessionRecording,
    /// Toggle the rich input editor for composing a prompt to send to a CLI agent.
    /// Triggered by Ctrl-G when a CLI agent is detected, or from the footer button.
    #[cfg(feature = "warp_services")]
    ToggleCLIAgentRichInput,

    /// Allow the blocked clipboard operation by adjusting the OSC 52 clipboard access setting.
    Osc52AllowBlockedClipboardOperation,
}

// Manually implementing Debug to avoid leaking sensitive information in logs
impl fmt::Debug for TerminalAction {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        use TerminalAction::*;

        match self {
            Scroll { delta } => write!(f, "Scroll {{ delta: {delta} }}"),
            AltScroll { delta, .. } => write!(f, "AltScroll {{ delta: {delta} }}"),
            #[cfg(feature = "warp_services")]
            SharedSessionViewerAltScroll { new_scroll_top } => write!(
                f,
                "SharedSessionViewerAltScroll {{ new_scroll_top: {new_scroll_top} }}"
            ),
            ScrollToTopOfBlock { topmost_block } => write!(
                f,
                "JumpToPreviousCommand {{ topmost_block: {topmost_block} }}"
            ),
            ScrollToTopOfSelectedBlocks => f.write_str("ScrollToTopOfSelectedBlocks"),
            ScrollToBottomOfSelectedBlocks => f.write_str("ScrollToBottomOfSelectedBlocks"),
            ScrollToBottomOfOverhangingBlock(overhanging_block) => {
                write!(f, "ScrollToBottomOfOverhangingBlock {overhanging_block:?}")
            }
            BlockTextSelect(action) => write!(f, "BlockTextSelect({action:?})"),
            BlockSelect { action, .. } => write!(f, "BlockSelect({action:?})"),
            BlockHover(action) => write!(f, "BlockHover({action:?})"),
            BlockSnackbarHover { is_hovered } => {
                write!(f, "BlockSnackbarHover{{ is_hovered {is_hovered} }}")
            }
            BlockNearSnackbarHover { is_hovered } => {
                write!(f, "BlockNearSnackbarHover{{ is_hovered {is_hovered} }}")
            }
            ClickOnGrid {
                position,
                modifiers,
            } => write!(
                f,
                "ClickOnGrid {{ position: {position:?}, modifiers: {modifiers:?} }}"
            ),
            MaybeLinkHover {
                position,
                from_editor,
            } => write!(
                f,
                "MaybeLinkHover {{ position: {position:?}, from_editor: {from_editor:?} }}"
            ),
            MaybeHoverSecret { secret_handle } => {
                write!(f, "MaybeHoverSecret {{ secret_handle: {secret_handle:?} }}")
            }
            MaybeDismissToolTip { from_keybinding } => write!(
                f,
                "MaybeDismissToolTip {{ from_keybinding: {from_keybinding:?}}}"
            ),
            AltSelect(action) => write!(f, "AltSelect({action:?})"),
            MaybeClearAltSelect => f.write_str("MaybeClearAltSelect"),
            AltMouseAction(action) => write!(f, "AltMouseAction({action:?})"),
            AltScreenContextMenu { position } => {
                write!(f, "AltScreenContextMenu {{ position: {position:?} }}")
            }
            BlockListContextMenu(menu) => write!(f, "BlockListContextMenu({menu:?})"),
            CloseContextMenu => f.write_str("CloseContextMenu"),
            Paste => f.write_str("Paste"),
            Copy => f.write_str("Copy"),
            CopyOutputs => f.write_str("CopyOutputs"),
            CopyCommands => f.write_str("CopyCommands"),
            CopyGitBranch => f.write_str("CopyGitBranch"),
            #[cfg(feature = "warp_services")]
            OpenShareModal => f.write_str("OpenShareModal"),
            ReinputCommands => f.write_str("ReinputCommands"),
            ReinputCommandsWithSudo => f.write_str("ReinputCommandsWithSudo"),
            ClearBuffer => f.write_str("ClearBuffer"),
            SelectBookmarkUp => f.write_str("SelectBookmarkUp"),
            #[cfg(feature = "warp_services")]
            JumpToLatestAgentMessage => f.write_str("JumpToLatestAgentMessage"),
            SelectBookmarkDown => f.write_str("SelectBookmarkDown"),
            Focus => f.write_str("Focus"),
            FocusInputAndClearSelection => f.write_str("FocusInputAndClearSelection"),
            ShowFindBar => f.write_str("ShowFindBar"),
            SelectPriorBlock => f.write_str("SelectPriorBlock"),
            SelectNextBlock => f.write_str("SelectNextBlock"),
            BookmarkSelectedBlock => f.write_str("BookmarkSelectedBlock"),
            Up => f.write_str("Up"),
            Down => f.write_str("Down"),
            PageUp => f.write_str("PageUp"),
            PageDown => f.write_str("PageDown"),
            Home => f.write_str("Home"),
            End => f.write_str("End"),
            KeyboardSelectText(direction) => write!(f, "KeyboardSelectText({direction:?})"),
            ContextMenu(action) => write!(f, "ContextMenu({action:?})"),
            CtrlD => f.write_str("CtrlD"),
            CtrlC => f.write_str("CtrlC"),
            ClearSelectionsWhenShellMode => {
                f.write_str("ClearSelectionsWhenShellMode(TerminalAction)")
            }
            Close => f.write_str("Close"),
            SplitRight(_) => f.write_str("SplitRight"),
            SplitLeft(_) => f.write_str("SplitLeft"),
            SplitDown(_) => f.write_str("SplitDown"),
            SplitUp(_) => f.write_str("SplitUp"),
            ToggleMaximizePane => f.write_str("ToggleMaximizeActivePane"),
            PromptContextMenu {
                position_offset_from_prompt,
            } => write!(
                f,
                "PromptContextMenu {{ position_offset_from_prompt: {position_offset_from_prompt:?} }}"
            ),
            OpenInputContextMenu { position } => {
                write!(f, "OpenInputContextMenu {{ position: {position:?} }}")
            }
            InputContextMenuItem(action) => write!(f, "InputContextMenuItem({action:?})"),
            SelectAllBlocks => f.write_str("SelectAllBlocks"),
            ExpandBlockSelectionAbove => f.write_str("ExpandBlockSelectionAbove"),
            ExpandBlockSelectionBelow => f.write_str("ExpandBlockSelectionBelow"),
            UserInputSequence(_) => f.write_str("UserInputSequence"),
            ControlSequence(_) => f.write_str("ControlSequence"),
            KeyDown(_) => f.write_str("KeyDown"),
            TypedCharacters(_) => f.write_str("TypedCharacters"),
            NotificationsDiscoveryBanner(action) => {
                write!(f, "NotificationsDiscoveryBanner({action:?})")
            }
            BookmarkBlock(index) => {
                write!(f, "BookmarkBlock({index:?})")
            }
            NotificationsErrorBanner(action) => write!(f, "NotificationsErrorBanner({action:?})"),
            JumpToBookmark(index) => write!(f, "JumpToBookmark({index:?})"),
            InsertCommandCorrection { .. } => {
                write!(f, "InsertCommandCorrection",)
            }
            OpenGridLink(_) => f.write_str("OpenGridLink"),
            OpenRichContentLink(_) => f.write_str("OpenRichContentLink"),
            ToggleGridSecret { show_secret, .. } => write!(f, "ToggleGridSecret {show_secret:?}"),
            ToggleRichContentSecret { show_secret, .. } => {
                write!(f, "ToggleRichContentSecret {show_secret:?}")
            }
            CopyGridSecret(_) => f.write_str("CopyGridSecret"),
            CopyRichContentSecret(_) => f.write_str("CopyRichContentSecret"),
            ShowInFileExplorer(_) => f.write_str("ShowInFileExplorer"),
            OpenFileInWarp(_) => f.write_str("OpenFileInWarp"),
            #[cfg(feature = "local_fs")]
            OpenCodeInWarp { .. } => f.write_str("OpenCodeInWarp"),
            #[cfg(feature = "warp_services")]
            OpenWorkflowModal => f.write_str("OpenWorkflowModal"),
            #[cfg(feature = "warp_services")]
            OpenWorkflowModalForAIWorkflow(_) => f.write_str("OpenWorkflowModalForAIWorkflow"),
            #[cfg(feature = "warp_services")]
            OpenWorkflowModalForBlock(block_index) => {
                write!(f, "OpenWorkflowModalForBlock({block_index:?})")
            }
            #[cfg(feature = "warp_services")]
            OpenWorkflowModalWithCloudWorkflow(_) => {
                f.write_str("OpenWorkflowModalWithCloudWorkflow")
            }
            OpenBlockListContextMenu => f.write_str("OpenBlockListContextMenu"),
            #[cfg(feature = "warp_services")]
            AskAIAssistant { block_index } => write!(f, "AskAIAssistant({block_index:?})"),
            TriggerSubshellBootstrap => f.write_str("TriggerSubshellBootstrap"),
            DismissWarpifyBanner(remember) => write!(f, "DismissWarpifyBanner({remember:?})"),
            ShowSubshellBanner(_) => f.write_str("ShowSubshellBanner"),
            InsertMostRecentCommandCorrection => f.write_str("InsertMostRecentCommandCorrection"),
            AliasExpansionBanner(action) => write!(f, "AliasExpansionBanner({action:?}"),
            OpenInWarpBanner(action) => write!(f, "OpenInWarpBanner({action:?})"),
            OpenBlockFilterEditor(block_index) => {
                write!(f, "OpenBlockFilterEditor({block_index:?})")
            }
            #[cfg(feature = "warp_services")]
            OnboardingFlow(version) => write!(f, "OnboardingFlow({version:?})"),
            ImportSettings => write!(f, "ImportSettings"),
            #[cfg(feature = "warp_services")]
            StopSharingCurrentSession { source } => {
                write!(f, "StopSharingCurrentSession({source:?})")
            }
            #[cfg(feature = "warp_services")]
            OpenSharedSessionOnDesktop { source } => {
                write!(f, "OpenSharedSessionOnDesktop({source:?})")
            }
            ToggleBlockFilterOnSelectedOrLastBlock(_) => {
                f.write_str("ToggleBlockFilterOnSelectedOrLastBlock")
            }
            #[cfg(feature = "warp_services")]
            OpenShareSessionModal { source } => write!(f, "OpenShareSessionModal({source:?})"),
            #[cfg(feature = "warp_services")]
            CopySharedSessionLink { .. } => f.write_str("CopySharedSessionLink"),
            VimModeBanner(action) => write!(f, "VimModeBanner({action:?})"),
            ToggleSnackbarInActivePane => write!(f, "ToggleSnackbarInActivePane"),
            #[cfg(feature = "warp_services")]
            MakeAllParticipantsReaders { reason } => {
                write!(f, "MakeAllParticipantsReaders {{ reason: {reason:?} }}")
            }
            #[cfg(feature = "warp_services")]
            OpenSharedSessionViewerRoleMenu => write!(f, "OpenSharedSessionViewerRoleMenu"),
            #[cfg(feature = "warp_services")]
            RequestSharedSessionRole(role) => write!(f, "RequestSharedSessionRole({role:?})"),
            MiddleClickOnGrid { position } => {
                write!(f, "MiddleClickonGrid {{ position: {position:?} }}")
            }
            MiddleClickOnInput => write!(f, "MiddleClickOnInput"),
            #[cfg(feature = "warp_services")]
            OpenAIBlockAttachedBlocksMenu { .. } => write!(f, "OpenAIBlockAttachedBlocksMenu"),
            #[cfg(feature = "warp_services")]
            OpenAIBlockOverflowMenu { .. } => write!(f, "OpenAIBlockOverflowMenu"),
            #[cfg(feature = "warp_services")]
            RewindAIConversation { .. } => write!(f, "RewindAIConversation"),
            #[cfg(feature = "warp_services")]
            ExecuteRewindAIConversation { .. } => write!(f, "ExecuteRewindAIConversation"),
            #[cfg(feature = "warp_services")]
            ExecuteRewindFromInlineMenu { .. } => write!(f, "ExecuteRewindFromInlineMenu"),
            #[cfg(feature = "warp_services")]
            SelectAIAttachedBlock(_) => write!(f, "SelectAIAttachedBlock"),
            DragAndDropFiles(_) => write!(f, "DragAndDropFiles"),
            #[cfg(feature = "warp_services")]
            SetInputModeAgent => write!(f, "SetInputModeAgent"),
            #[cfg(feature = "warp_services")]
            SetInputModeTerminal => write!(f, "SetInputModeTerminal"),
            #[cfg(feature = "warp_services")]
            #[cfg(feature = "voice_input")]
            ToggleCLIAgentVoiceInput(source) => write!(f, "ToggleCLIAgentVoiceInput({source:?})"),
            HyperlinkClick(hyperlink_url) => write!(f, "HyperlinkClick({hyperlink_url:?})"),
            #[cfg(feature = "warp_services")]
            AttemptLoginGatedFeature => write!(f, "AttemptLoginGatedFeature"),
            StartFileDropTarget => write!(f, "StartFileDropTarget"),
            StopFileDropTarget => write!(f, "StopFileDropTarget"),
            RunNativeShellCompletions { buffer_text, .. } => {
                write!(f, "RunNativeShellCompletions({buffer_text:?})")
            }
            #[cfg(feature = "warp_services")]
            OpenTeamSettingsPage => write!(f, "OpenTeamSettingsPage"),
            SetMarkedText {
                marked_text,
                selected_range,
            } => write!(f, "SetMarkedText {{{marked_text:?}, {selected_range:?}}}"),
            ClearMarkedText => write!(f, "ClearMarkedText"),
            #[cfg(feature = "warp_services")]
            HideTelemetryBannerPermanently => write!(f, "HideTelemetryBannerPermanently"),
            ShowInitializationBlock => write!(f, "ShowInitializationBlock"),
            #[cfg(feature = "warp_services")]
            GenerateCodebaseIndex => write!(f, "GenerateIndexForRepo"),
            #[cfg(feature = "warp_services")]
            LoadAgentModeConversation => write!(f, "LoadAgentModeConversation"),
            ShowWarpifySettings => write!(f, "ShowWarpifySettings"),
            #[cfg(feature = "warp_services")]
            DeleteAttachment { index } => write!(f, "DeleteAttachment({index:?})"),
            #[cfg(feature = "warp_services")]
            OpenAttachmentLightbox { index } => {
                write!(f, "OpenAttachmentLightbox({index:?})")
            }
            #[cfg(feature = "warp_services")]
            WriteCodebaseIndex => write!(f, "PersistCodebaseIndex"),
            #[cfg(feature = "warp_services")]
            AttachFile => write!(f, "AttachFile"),
            #[cfg(feature = "warp_services")]
            ToggleAutoexecuteMode => write!(f, "ToggleAutoexecuteMode"),
            #[cfg(feature = "warp_services")]
            ToggleQueueNextPrompt => write!(f, "ToggleQueueNextPrompt"),
            #[cfg(feature = "warp_services")]
            CodebaseIndexSpeedbumpBanner(action) => {
                write!(f, "CodebaseIndexSpeedbumpBanner({action:?})")
            }
            #[cfg(feature = "warp_services")]
            AgentModeSetupSpeedbumpBanner(action) => {
                write!(f, "AgentModeSetupSpeedbumpBanner({action:?})")
            }
            #[cfg(feature = "warp_services")]
            ResumeConversation => write!(f, "ResumeConversation"),
            #[cfg(feature = "warp_services")]
            ForkConversationFromLastKnownGoodState => {
                write!(f, "ForkConversationFromLastKnownGoodState")
            }
            #[cfg(feature = "warp_services")]
            ToggleAIDocumentPane => write!(f, "ToggleAIDocumentPane"),
            #[cfg(feature = "warp_services")]
            ToggleTodoPopup => write!(f, "ToggleTodoPopup"),
            #[cfg(feature = "warp_services")]
            CloseTodoPopup => write!(f, "CloseTodoPopup"),
            #[cfg(feature = "warp_services")]
            ToggleCodeReviewPane { .. } => write!(f, "ToggleCodeReviewPane"),
            #[cfg(feature = "warp_services")]
            InitProject => write!(f, "InitProject"),
            #[cfg(feature = "warp_services")]
            IndexProjectSpeedbump => write!(f, "IndexProject"),
            AddProjectAtCurrentDirectory => write!(f, "AddProjectAtCurrentDirectory"),
            #[cfg(feature = "warp_services")]
            OpenProjectRulesPane => write!(f, "OpenProjectRulesPane"),
            #[cfg(feature = "warp_services")]
            OpenViewMCPPane => write!(f, "OpenViewMCPPane"),
            #[cfg(feature = "warp_services")]
            OpenAddMCPPane => write!(f, "OpenAddMCPPane"),
            #[cfg(feature = "warp_services")]
            OpenAddRulePane => write!(f, "OpenAddRulePane"),
            #[cfg(feature = "warp_services")]
            OpenRulesPane => write!(f, "OpenRulesPane"),
            #[cfg(feature = "warp_services")]
            OpenEditSkillPane { .. } => write!(f, "OpenEditSkillPane"),
            #[cfg(feature = "warp_services")]
            OpenAddPromptPane => write!(f, "OpenAddPromptPane"),
            #[cfg(feature = "warp_services")]
            OpenBillingAndUsagePane => write!(f, "OpenBillingAndUsagePane"),
            #[cfg(feature = "warp_services")]
            OpenConversationsPalette => write!(f, "OpenConversationsPalette"),
            PickRepoToOpen => write!(f, "PickRepoToOpen"),
            OpenFilesPalette { .. } => write!(f, "OpenFilesPalette"),
            DismissCodeToolbeltTooltip => write!(f, "DismissCodeToolbeltTooltip"),
            StartLspServer => write!(f, "StartLspServer"),
            #[cfg(feature = "warp_services")]
            SetupCloudEnvironment(_) => write!(f, "SetupCloudEnvironment"),
            #[cfg(feature = "warp_services")]
            SetupCloudEnvironmentAndStart(_) => write!(f, "SetupCloudEnvironmentAndStart"),
            #[cfg(feature = "warp_services")]
            TriggerEnvironmentSetupSelection(_) => write!(f, "TriggerEnvironmentSetupSelection"),
            #[cfg(feature = "warp_services")]
            OpenEnvironmentManagementPane => write!(f, "OpenEnvironmentManagementPane"),
            #[cfg(feature = "warp_services")]
            SummarizeConversation => write!(f, "SummarizeConversation"),
            #[cfg(feature = "warp_services")]
            ToggleLongRunningCommandControl => {
                write!(f, "TakeOverLongRunningCommandControlForUser")
            }
            #[cfg(feature = "warp_services")]
            ToggleHideCliResponses => write!(f, "ToggleHideCliResponses"),
            #[cfg(feature = "warp_services")]
            ExitAgentView => write!(f, "ExitAgentView"),
            #[cfg(feature = "warp_services")]
            EnterCloudAgentView => write!(f, "EnterCloudAgentView"),
            #[cfg(feature = "warp_services")]
            StartNewAgentConversation { origin } => {
                write!(f, "StartNewAgentConversation {{ origin: {origin:?} }}")
            }
            #[cfg(feature = "warp_services")]
            ToggleConversationDetailsPanel => write!(f, "ToggleConversationDetailsPanel"),
            #[cfg(feature = "warp_services")]
            CancelAmbientAgentTask => write!(f, "CancelAmbientAgentTask"),
            #[cfg(feature = "warp_services")]
            OpenInlineHistoryMenu => write!(f, "OpenInlineHistoryMenu"),
            #[cfg(feature = "warp_services")]
            OpenModelSelector => write!(f, "OpenModelSelector"),
            #[cfg(feature = "warp_services")]
            ResolvePromptSuggestion(..) => write!(f, "ResolvePromptSuggestion"),
            #[cfg(feature = "warp_services")]
            AwsBedrockLoginBanner(action) => write!(f, "AwsBedrockLoginBanner({action:?})"),
            #[cfg(feature = "warp_services")]
            AwsCliNotInstalledBanner(action) => write!(f, "AwsCliNotInstalledBanner({action:?})"),
            #[cfg(feature = "warp_services")]
            ToggleUsageFooter => write!(f, "ToggleUsageFooter"),
            #[cfg(feature = "warp_services")]
            RevealChildAgent { .. } => write!(f, "RevealChildAgent"),
            #[cfg(feature = "warp_services")]
            SwitchAgentViewToConversation { .. } => write!(f, "SwitchAgentViewToConversation"),
            #[cfg(feature = "warp_services")]
            OpenChildAgentInNewPane { .. } => write!(f, "OpenChildAgentInNewPane"),
            #[cfg(feature = "warp_services")]
            OpenChildAgentInNewTab { .. } => write!(f, "OpenChildAgentInNewTab"),
            #[cfg(feature = "warp_services")]
            StopAgentConversation { .. } => write!(f, "StopAgentConversation"),
            #[cfg(feature = "warp_services")]
            KillAgentConversation { .. } => write!(f, "KillAgentConversation"),
            #[cfg(feature = "warp_services")]
            CyclePreviousOrchestrationChildAgent => {
                write!(f, "CyclePreviousOrchestrationChildAgent")
            }
            #[cfg(feature = "warp_services")]
            CycleNextOrchestrationChildAgent => write!(f, "CycleNextOrchestrationChildAgent"),
            ToggleSessionRecording => write!(f, "ToggleSessionRecording"),
            #[cfg(feature = "warp_services")]
            ToggleCLIAgentRichInput => write!(f, "ToggleCLIAgentRichInput"),
            Osc52AllowBlockedClipboardOperation => {
                write!(f, "Osc52AllowBlockedClipboardOperation")
            }
        }
    }
}
