#!/usr/bin/env node
// Regenerates app/help/courseHtml.ts from Staff-Guide.html.
//
// The course is authored as a plain, self-contained HTML file so it can be
// opened, edited, and emailed on its own. This script copies it into a TS
// module so /help can serve it without touching the filesystem at runtime.
//
//   npm run sync:course

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "Staff-Guide.html");
const OUT = join(root, "app", "help", "courseHtml.ts");

const html = readFileSync(SRC, "utf8");

// String.raw` ... ` can't contain a backtick or a ${ sequence.
const hazards = [];
if (html.includes("`")) hazards.push("a backtick (`)");
if (html.includes("${")) hazards.push("a ${ sequence");
if (hazards.length) {
  console.error(
    `\n✗ The course contains ${hazards.join(" and ")}, which breaks the embedded template literal.\n` +
      `  Remove it from Staff-Guide.html, then run this again.\n`
  );
  process.exit(1);
}

const header = `// The full staff training course, kept as one self-contained HTML document.
// It renders inside a sandboxed iframe on /help so its stylesheet stays
// completely isolated from the rest of the site (and vice versa).
//
// GENERATED FILE — do not edit directly.
// Edit Staff-Guide.html at the repo root, then run:
//   npm run sync:course

import { applyBrandTokens } from "@/lib/brand";

export const COURSE_HTML_RAW = String.raw\``;

const footer =
  "\n\n// Brand tokens ({{BRAND}}, {{MEMBERS}}, {{SUPPORT}}, …) are filled from brand.config.ts at runtime.\n" +
  "export const COURSE_HTML = applyBrandTokens(COURSE_HTML_RAW);\n";
writeFileSync(OUT, header + html + "`;" + footer, "utf8");
console.log(`✓ Synced course → app/help/courseHtml.ts (${(html.length / 1024).toFixed(1)} KB)`);
