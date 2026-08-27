# Contributing to Doom Term

Thank you for your interest in contributing to **Doom Term**!

## 📜 Code of Conduct & Design Principles

Doom Term follows a strict set of design and engineering principles:

1. **Zero Border Radius**: Every element enforces `* { border-radius: 0 }`. Never introduce rounded corners or soft pill buttons.
2. **Hard 1px Bevels Only**: Depth is produced solely via `--bevel-up` and `--bevel-dn`. No blurred box-shadows or drop-shadow filters.
3. **Calibrated Colors**:
   - Live: `#e0a92c`
   - Passed: `#5c9c3a`
   - Failed: `#d40b06`
   - Waiting: `#3a6fd8`
   - Idle: `#6b645a`
4. **Integer Plate Scaling**: Plate rendering must scale at discrete integer multiples (`1x`, `2x`, `3x`, `4x`).
5. **No Icon Libraries**: Use plain Unicode / ASCII glyphs (`▸`, `▪`, `×`, `⚖`, `❖`, `⑂`) to preserve high-DPI retro sharpness without runtime asset bloat.

---

## 🛠️ Development Workflow

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/CMLeadmon/Doom-Term.git
   cd Doom-Term
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests before submitting a PR:
   ```bash
   npm test
   npm run build
   cargo check --manifest-path backend/Cargo.toml
   ```
4. Ensure all unit and component tests pass with 100% success rate.
