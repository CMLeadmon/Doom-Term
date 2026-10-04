# Tab groups and default directories

Open the **+** menu to create a tab group or choose an installed supported shell.
On Windows, the shell picker also uses the existing WSL distribution discovery.
The same menu is available with horizontal tabs and the vertical sidebar.

Right-click a group's header to rename it, choose a color, create a terminal in it,
or set its **Default directory…**. Existing tabs can join it through **Move to group**.
Closing, moving, or ungrouping its last member leaves the group available. Its name,
color, directory, and position survive a restart. Use **Delete group** to remove an
empty group; **Close group** explicitly removes a populated group and its tabs.

The directory editor supports three modes:

- **No default** uses the normal terminal startup directory behavior.
- **Local** accepts an existing absolute directory or a path starting with `~`.
- **SSH** accepts a host or OpenSSH configuration alias, an optional username and
  port, and a directory on the remote machine. Use an absolute path or `~/Projects`
  to select a path relative to the remote account's home directory.

For example, select SSH, set host to `example.com`, username to `carter`, and directory
to `/var/home/carter/Projects`. Each new terminal tab or split in that group runs SSH
and opens an interactive remote shell in that directory. Host-key confirmation,
passwords, keys, and other authentication remain in the terminal. Passwords are not
part of the saved group configuration. OpenSSH aliases and configuration are respected.

Group defaults take precedence over a pane's current directory and global startup
settings. Changing or clearing a default affects future terminals; running panes keep
their sessions. A saved local directory that is subsequently removed produces a visible
error in the new terminal. A failed remote directory change does not start a remote
shell in a different directory. Disconnecting from SSH returns to the local shell.

## Verification

The implementation report is at `evidence.html`, with a dedicated report at
`evidence/tab-groups/report.html`. Serve the checkout with:

```sh
python3 -m http.server 8085 --bind 127.0.0.1
```

Focused production-module and migration tests:

```sh
./script/doomterm/test-tab-groups
python3 -m unittest discover -s script/doomterm -p 'test_group_persistence.py'
python3 -m unittest discover -s script/doomterm -p 'test_runtime_flags.py'
./script/doomterm/test-tab-groups --clippy
```

Install Fish to execute the Fish quoting checks. The module runner imports the real
production Rust module; it avoids the app test target's existing hosted-service dependency
coupling. It uses cargo nextest when installed and otherwise uses cargo test.

The native GUI smoke check requires Podman and the existing Ubuntu verification image
(`script/doomterm/Containerfile.verify`). Build the Doom Term GUI, then run:

```sh
./script/doomterm/test-tab-groups-gui --binary /absolute/path/to/target/debug/doomterm
```

It launches the actual app in an isolated Xvfb profile, checks terminal `pwd` output
and the session database, restarts the app, and saves screenshots and a JSON result.
Real SSH verification is documented separately in the evidence report because it needs
an accessible remote account and interactive authentication.
