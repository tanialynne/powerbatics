// CLI wrapper: parses generatedHTML.html → program.json.
// Run: node parse.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { parseProgramHtml } from "./parser.mjs";

const html = readFileSync("generatedHTML.html", "utf8");
const program = parseProgramHtml(html);
writeFileSync("program.json", JSON.stringify(program, null, 2));

const total = program.days.reduce((n, d) => n + d.exercises.length, 0);
console.log(
  `Wrote program.json — ${program.days.length} sections, ${total} exercises.`,
);
for (const d of program.days)
  console.log(`  ${d.name}: ${d.exercises.length} exercises`);
