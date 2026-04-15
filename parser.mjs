// Parses a coach's Elementor custom-program HTML page into a program object.
// Shared by the Node CLI (parse.mjs) and the browser app (app.js), so the
// same logic runs on save-from-disk and on live-refresh from the proxy.

export function parseProgramHtml(html) {
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

    const dayMatch = title.match(/^DAY\s*(\d+)$/i);
    if (dayMatch) {
      currentDay = { name: `Day ${dayMatch[1]}`, exercises: [] };
      program.days.push(currentDay);
      continue;
    }

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

  if (program.days[0].exercises.length === 0) program.days.shift();
  return program;
}
