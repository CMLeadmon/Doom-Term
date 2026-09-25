use async_channel::Sender;
pub use warp_terminal::shell::{shell_escape_single_quotes, shell_quote_arg};

use crate::terminal::model::session::command_executor::{
    InBandCommand, InBandCommandCancelledEvent,
};
#[cfg(not(feature = "warp_services"))]
use crate::terminal::shell::ShellType;

/// Set of events sent by command executors.
pub enum ExecutorCommandEvent {
    /// The command should be executed.
    ExecuteCommand {
        command: InBandCommand,
        /// A Sender that can be used to signal that the command has been cancelled.
        /// Lets us unblock the command in the executor.
        cancel_tx: Sender<InBandCommandCancelledEvent>,
    },
    /// The command identified by `id` should be cancelled.
    CancelCommand { id: String },
}

/// Serializes constant `name=value` assignments for `shell_type` as one line, quoting each
/// value for the shell.
///
/// This is the constant-value case of `crate::env_vars::serialize_variables_for_shell`, which
/// Doom Term compiles out with environment variable collections. The SSH and WSL executors
/// still pass variables to the commands they run this way.
#[cfg(not(feature = "warp_services"))]
pub fn serialize_constants_for_shell<'s>(
    pairs: impl IntoIterator<Item = (&'s str, &'s str)>,
    shell_type: ShellType,
) -> String {
    use itertools::Itertools as _;
    use warp_util::path::ShellFamily;

    let shell_family = ShellFamily::from(shell_type);
    let (prefix, separator, postfix) = match shell_type {
        // The same forms the hosted serializer writes for each shell.
        ShellType::Fish => ("set -x ", " ", ";"),
        ShellType::Bash | ShellType::Zsh => ("", "=", ""),
        ShellType::PowerShell => ("$env:", " = ", ";"),
    };
    pairs
        .into_iter()
        .map(|(name, value)| {
            let value = match shell_family {
                ShellFamily::Posix => shell_family.escape(value).into_owned(),
                ShellFamily::PowerShell => format!("'{}'", value.replace('\'', "''")),
            };
            format!(
                "{prefix}{}{separator}{value}{postfix}",
                shell_family.escape(name)
            )
        })
        .join(" ")
}
