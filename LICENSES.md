# Licensing

Doom Term retains the licensing of the upstream code it modifies. This index describes the repository's
license boundaries; the full license texts and file-specific notices govern their respective material.

| Material | License or rights record |
| --- | --- |
| Application and workspace crates using the default license | AGPL-3.0-only: [LICENSE](LICENSE), also preserved as [LICENSE-AGPL](LICENSE-AGPL) |
| `crates/warpui` and `crates/warpui_core` | MIT: [LICENSE-MIT](LICENSE-MIT), as declared in their Cargo manifests |
| Files with explicit third-party notices | Their stated licenses and copyright notices; see [NOTICE.md](NOTICE.md) |
| Optional gameplay recordings and other third-party media | Separate rights described in the asset documentation; not relicensed by the application license |

The workspace declares `AGPL-3.0-only`, not a choice between AGPL and MIT for the whole application.
The MIT exception is specific to the UI framework crates. File-specific licenses remain authoritative.

Contributions use the applicable existing license. Copyright remains with its respective holders;
Doom Term does not claim ownership of upstream or third-party work.

For distribution, retain applicable notices and provide corresponding source as required by the
licenses. Consult the complete license text for obligations, including those that can apply to a
modified AGPL program used over a network. The repository's public source history identifies the
source revisions used for releases.

The canonical LICENSE contains the same AGPL text as LICENSE-AGPL. Both original license files are
retained for existing references. [NOTICE.md](NOTICE.md) records attribution and trademark context.
