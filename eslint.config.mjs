import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  ...obsidianmd.configs.recommended,
  { ignores: ["main.js", "node_modules/**", "test-vault/**", "3d-test-vault/**", "tests/**", "scripts/**", "esbuild.config.mjs", "eslint.config.mjs"] },
  { files: ["src/**/*.ts"], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, rules: {
    "obsidianmd/ui/sentence-case": ["warn", { brands: ["File Placer", "Pinit to Top or Bottom", "Pinit", "Obsidian"], acronyms: ["2D", "3D"] }],
    // Keep the imperative settings API for Obsidian 1.7.2 compatibility.
    "obsidianmd/settings-tab/prefer-setting-definitions": "off",
  } },
];
