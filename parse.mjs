// Parses generatedHTML.html → program.json.
// Run: node parse.mjs
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("generatedHTML.html", "utf8");

// Each exercise/section is wrapped in an `<section class="elementor-section elementor-top-section ...">`.
// Within it: optional heading <h2>, optional description <p>(s), optional vimeo iframe.
// Day delimiters are sections whose heading text matches /^DAY\s*\d+$/i.

const sectionRe =
  /<section\b[^>]*class="[^"]*elementor-top-section[^"]*"[\s\S]*?<\/section>/g;
const headingRe =
  /<h2\b[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i;
const textWidgetRe =
  /<div[^>]*data-widget_type="text-editor\.default"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i;
const paraRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
const vimeoRe = /player\.vimeo\.com\/video\/(\d+)/i;

const stripTags = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();

const program = { title: null, intro: null, days: [] };
let currentDay = { name: "Warm Up", exercises: [] };
program.days.push(currentDay);

const matches = html.match(sectionRe) || [];
for (const sec of matches) {
  const hMatch = sec.match(headingRe);
  if (!hMatch) continue;
  const title = stripTags(hMatch[1]);
  if (!title) continue;

  // Day delimiter
  const dayMatch = title.match(/^DAY\s*(\d+)$/i);
  if (dayMatch) {
    currentDay = { name: `Day ${dayMatch[1]}`, exercises: [] };
    program.days.push(currentDay);
    continue;
  }

  // Capture description paragraphs
  const textMatch = sec.match(textWidgetRe);
  let description = "";
  let goal = "";
  if (textMatch) {
    const inner = textMatch[1];
    const paras = [];
    let p;
    paraRe.lastIndex = 0;
    while ((p = paraRe.exec(inner)) !== null) {
      const text = stripTags(p[1]);
      if (text) paras.push(text);
    }
    for (const para of paras) {
      const m = para.match(/^Goal\s*:?\s*(.*)$/i);
      if (m) {
        goal = m[1].trim();
      } else {
        const d = para.match(/^Description\s*:?\s*(.*)$/i);
        description += (description ? " " : "") + (d ? d[1].trim() : para);
      }
    }
  }

  const v = sec.match(vimeoRe);
  const videoId = v ? v[1] : null;

  // Program intro (first heading) — capture, don't add as exercise.
  if (!program.title) {
    program.title = title;
    program.intro = description || null;
    continue;
  }

  currentDay.exercises.push({
    name: title,
    description: description || null,
    goal: goal || null,
    videoId,
  });
}

// Drop empty leading bucket if it has no exercises
if (program.days[0].exercises.length === 0) program.days.shift();

writeFileSync("program.json", JSON.stringify(program, null, 2));
console.log(
  `Wrote program.json — ${program.days.length} sections, ${program.days
    .reduce((n, d) => n + d.exercises.length, 0)} exercises.`,
);
for (const d of program.days)
  console.log(`  ${d.name}: ${d.exercises.length} exercises`);
