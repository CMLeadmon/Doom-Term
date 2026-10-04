use warp_editor::editor::NavigationKey;
use warpui::elements::{
    ChildView, Container, CrossAxisAlignment, Flex, MainAxisSize, MouseStateHandle, ParentElement,
    Text,
};
use warpui::keymap::FixedBinding;
use warpui::keymap::macros::*;
use warpui::platform::Cursor;
use warpui::ui_components::button::ButtonVariant;
use warpui::ui_components::components::{UiComponent, UiComponentStyles};
use warpui::{
    AppContext, Element, Entity, FocusContext, SingletonEntity, TypedActionView, View, ViewContext,
    ViewHandle,
};

use crate::appearance::Appearance;
use crate::editor::{
    EditorView, Event as EditorEvent, PropagateAndNoOpNavigationKeys, SingleLineEditorOptions,
    TextOptions,
};
use crate::view_components::action_button::{ActionButton, NakedTheme, PrimaryTheme};
use crate::workspace::group_directory::GroupDirectory;
use crate::workspace::tab_group::TabGroupId;

pub fn init(app: &mut AppContext) {
    app.register_fixed_bindings(vec![FixedBinding::new(
        "escape",
        GroupDirectoryAction::Cancel,
        id!("GroupDirectoryEditor"),
    )]);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectoryMode {
    NoDefault,
    Local,
    Ssh,
}

pub struct GroupDirectoryEditor {
    group_id: Option<TabGroupId>,
    mode: DirectoryMode,
    fields: Vec<ViewHandle<EditorView>>,
    mode_mouse_states: [MouseStateHandle; 3],
    save: ViewHandle<ActionButton>,
    clear: ViewHandle<ActionButton>,
    cancel: ViewHandle<ActionButton>,
    error: Option<String>,
}

pub enum GroupDirectoryEvent {
    Save {
        group_id: TabGroupId,
        directory: Option<GroupDirectory>,
    },
    Cancel,
}

#[derive(Debug)]
pub enum GroupDirectoryAction {
    Mode(DirectoryMode),
    Save,
    Clear,
    Cancel,
}

impl GroupDirectoryEditor {
    pub fn new(ctx: &mut ViewContext<Self>) -> Self {
        let mut fields = Vec::new();
        for (index, placeholder) in [
            "/path/to/project or ~/projects",
            "hostname or SSH alias",
            "Optional username",
            "22",
        ]
        .into_iter()
        .enumerate()
        {
            let editor = ctx.add_typed_action_view(|ctx| {
                let mut editor = EditorView::single_line(
                    SingleLineEditorOptions {
                        text: TextOptions::ui_font_size(Appearance::as_ref(ctx)),
                        propagate_and_no_op_vertical_navigation_keys:
                            PropagateAndNoOpNavigationKeys::Always,
                        ..Default::default()
                    },
                    ctx,
                );
                editor.set_placeholder_text(placeholder, ctx);
                editor
            });
            ctx.subscribe_to_view(&editor, move |me, _, event, ctx| match event {
                EditorEvent::Enter => me.save(ctx),
                EditorEvent::Escape => ctx.emit(GroupDirectoryEvent::Cancel),
                EditorEvent::Navigate(key @ (NavigationKey::Tab | NavigationKey::ShiftTab)) => {
                    let visible = if me.mode == DirectoryMode::Ssh {
                        vec![1, 2, 3, 0]
                    } else {
                        vec![0]
                    };
                    let current = visible
                        .iter()
                        .position(|field| *field == index)
                        .unwrap_or(0);
                    let next = if matches!(key, NavigationKey::Tab) {
                        (current + 1) % visible.len()
                    } else {
                        (current + visible.len() - 1) % visible.len()
                    };
                    ctx.focus(&me.fields[visible[next]]);
                }
                EditorEvent::Edited(_) => {
                    me.error = None;
                    ctx.notify();
                }
                _ => {}
            });
            fields.push(editor);
        }
        let save = ctx.add_typed_action_view(|_| {
            ActionButton::new("Save", PrimaryTheme)
                .on_click(|ctx| ctx.dispatch_typed_action(GroupDirectoryAction::Save))
        });
        let clear = ctx.add_typed_action_view(|_| {
            ActionButton::new("Clear default", NakedTheme)
                .on_click(|ctx| ctx.dispatch_typed_action(GroupDirectoryAction::Clear))
        });
        let cancel = ctx.add_typed_action_view(|_| {
            ActionButton::new("Cancel", NakedTheme)
                .on_click(|ctx| ctx.dispatch_typed_action(GroupDirectoryAction::Cancel))
        });
        Self {
            group_id: None,
            mode: DirectoryMode::NoDefault,
            fields,
            mode_mouse_states: Default::default(),
            save,
            clear,
            cancel,
            error: None,
        }
    }

    pub fn configure(
        &mut self,
        group_id: TabGroupId,
        directory: Option<GroupDirectory>,
        ctx: &mut ViewContext<Self>,
    ) {
        self.group_id = Some(group_id);
        self.error = None;
        let (mode, values) = match directory {
            None => (DirectoryMode::NoDefault, vec![String::new(); 4]),
            Some(GroupDirectory::Local { directory }) => (
                DirectoryMode::Local,
                vec![directory, String::new(), String::new(), String::new()],
            ),
            Some(GroupDirectory::Ssh {
                host,
                username,
                port,
                directory,
            }) => (
                DirectoryMode::Ssh,
                vec![
                    directory,
                    host,
                    username.unwrap_or_default(),
                    port.map(|port| port.to_string()).unwrap_or_default(),
                ],
            ),
        };
        self.mode = mode;
        for (editor, value) in self.fields.iter().zip(values) {
            editor.update(ctx, |editor, ctx| {
                editor.system_reset_buffer_text(&value, ctx)
            });
        }
        ctx.notify();
    }

    fn value(&self, index: usize, ctx: &AppContext) -> String {
        self.fields[index].as_ref(ctx).buffer_text(ctx).to_owned()
    }

    fn save(&mut self, ctx: &mut ViewContext<Self>) {
        let directory = match self.mode {
            DirectoryMode::Local => Some(GroupDirectory::Local {
                directory: self.value(0, ctx),
            }),
            DirectoryMode::Ssh => {
                let port = self.value(3, ctx).trim().to_owned();
                let port = if port.is_empty() {
                    None
                } else {
                    match port.parse::<u16>() {
                        Ok(port) if port > 0 => Some(port),
                        _ => {
                            self.error = Some("Enter a port between 1 and 65535.".into());
                            ctx.notify();
                            return;
                        }
                    }
                };
                let username = self.value(2, ctx).trim().to_owned();
                Some(GroupDirectory::Ssh {
                    host: self.value(1, ctx).trim().to_owned(),
                    username: (!username.is_empty()).then_some(username),
                    port,
                    directory: self.value(0, ctx),
                })
            }
            DirectoryMode::NoDefault => None,
        };
        if let Some(directory) = &directory
            && let Err(message) = directory.validate()
        {
            self.error = Some(message);
            ctx.notify();
            return;
        }
        if let Some(group_id) = self.group_id {
            ctx.emit(GroupDirectoryEvent::Save {
                group_id,
                directory,
            });
        }
    }
}

impl Entity for GroupDirectoryEditor {
    type Event = GroupDirectoryEvent;
}

impl View for GroupDirectoryEditor {
    fn ui_name() -> &'static str {
        "GroupDirectoryEditor"
    }

    fn on_focus(&mut self, focus_ctx: &FocusContext, ctx: &mut ViewContext<Self>) {
        if focus_ctx.is_self_focused() && self.mode != DirectoryMode::NoDefault {
            ctx.focus(
                &self.fields[if self.mode == DirectoryMode::Ssh {
                    1
                } else {
                    0
                }],
            );
        }
    }

    fn render(&self, app: &AppContext) -> Box<dyn Element> {
        let appearance = Appearance::as_ref(app);
        let theme = appearance.theme();
        let label = |text: &str| {
            Text::new_inline(text.to_owned(), appearance.ui_font_family(), 13.)
                .with_color(theme.active_ui_text_color().into())
                .finish()
        };
        let mut column = Flex::column()
            .with_main_axis_size(MainAxisSize::Min)
            .with_cross_axis_alignment(CrossAxisAlignment::Stretch)
            .with_spacing(14.);
        column.add_child(label("New tabs and split panes start in this directory."));
        let mut modes = Flex::row().with_spacing(8.);
        for (mode, text) in [
            (DirectoryMode::NoDefault, "No default"),
            (DirectoryMode::Local, "Local"),
            (DirectoryMode::Ssh, "SSH"),
        ] {
            let mouse_index = match mode {
                DirectoryMode::NoDefault => 0,
                DirectoryMode::Local => 1,
                DirectoryMode::Ssh => 2,
            };
            modes.add_child(
                appearance
                    .ui_builder()
                    .button(
                        if mode == self.mode {
                            ButtonVariant::Accent
                        } else {
                            ButtonVariant::Basic
                        },
                        self.mode_mouse_states[mouse_index].clone(),
                    )
                    .with_centered_text_label(text.to_owned())
                    .build()
                    .with_cursor(Cursor::PointingHand)
                    .on_click(move |ctx, _, _| {
                        ctx.dispatch_typed_action(GroupDirectoryAction::Mode(mode))
                    })
                    .finish(),
            );
        }
        column.add_child(modes.finish());
        let rows = match self.mode {
            DirectoryMode::Local => vec![(0, "Directory")],
            DirectoryMode::Ssh => vec![
                (1, "SSH host"),
                (2, "Username (optional)"),
                (3, "Port (optional)"),
                (0, "Remote directory"),
            ],
            DirectoryMode::NoDefault => vec![],
        };
        for (index, text) in rows {
            column.add_child(
                Flex::column()
                    .with_spacing(5.)
                    .with_child(label(text))
                    .with_child(
                        appearance
                            .ui_builder()
                            .text_input(self.fields[index].clone())
                            .with_style(UiComponentStyles {
                                height: Some(34.),
                                ..Default::default()
                            })
                            .build()
                            .finish(),
                    )
                    .finish(),
            );
        }
        if self.mode == DirectoryMode::Ssh {
            column.add_child(label("SSH will ask for authentication in the terminal."));
        }
        if let Some(error) = &self.error {
            column.add_child(
                Text::new_inline(error.clone(), appearance.ui_font_family(), 12.)
                    .with_color(theme.ui_error_color())
                    .finish(),
            );
        }
        column.add_child(
            Flex::row()
                .with_spacing(12.)
                .with_child(ChildView::new(&self.clear).finish())
                .with_child(ChildView::new(&self.cancel).finish())
                .with_child(ChildView::new(&self.save).finish())
                .finish(),
        );
        Container::new(column.finish())
            .with_uniform_padding(20.)
            .finish()
    }
}

impl TypedActionView for GroupDirectoryEditor {
    type Action = GroupDirectoryAction;
    fn handle_action(&mut self, action: &GroupDirectoryAction, ctx: &mut ViewContext<Self>) {
        match action {
            GroupDirectoryAction::Mode(mode) => {
                self.mode = *mode;
                self.error = None;
                ctx.notify();
                if *mode != DirectoryMode::NoDefault {
                    ctx.focus(&self.fields[if *mode == DirectoryMode::Ssh { 1 } else { 0 }]);
                }
            }
            GroupDirectoryAction::Save => self.save(ctx),
            GroupDirectoryAction::Clear => {
                if let Some(group_id) = self.group_id {
                    ctx.emit(GroupDirectoryEvent::Save {
                        group_id,
                        directory: None,
                    });
                }
            }
            GroupDirectoryAction::Cancel => ctx.emit(GroupDirectoryEvent::Cancel),
        }
    }
}
