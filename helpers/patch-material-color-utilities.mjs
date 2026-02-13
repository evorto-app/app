import fs from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(
  "node_modules",
  "@material",
  "material-color-utilities",
);

const replacements = [
  {
    file: "dynamiccolor/color_spec_2025.js",
    from: "from './dynamic_color';",
    to: "from './dynamic_color.js';",
  },
  {
    file: "scheme/scheme_content.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_expressive.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_fidelity.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_fruit_salad.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_monochrome.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_neutral.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_rainbow.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_tonal_spot.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
  {
    file: "scheme/scheme_vibrant.js",
    from: "from '../dynamiccolor/dynamic_scheme';",
    to: "from '../dynamiccolor/dynamic_scheme.js';",
  },
];

const run = async () => {
  try {
    await fs.access(packageRoot);
  } catch {
    return;
  }

  let changedFiles = 0;

  for (const replacement of replacements) {
    const filePath = path.join(packageRoot, replacement.file);
    const current = await fs.readFile(filePath, "utf8");
    if (!current.includes(replacement.from)) {
      continue;
    }
    await fs.writeFile(
      filePath,
      current.replaceAll(replacement.from, replacement.to),
    );
    changedFiles += 1;
  }

  if (changedFiles > 0) {
    process.stdout.write(
      `patched @material/material-color-utilities (${changedFiles} files)\n`,
    );
  }
};

await run();
