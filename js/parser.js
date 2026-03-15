export function parseScript(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const entities = [], relationships = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    if (/^ENTIDADE\s+\S+/i.test(line)) {
      const name = line.replace(/^ENTIDADE\s+/i,'').trim();
      const attrs = [];
      i++;
      while (i < lines.length && !/^FIM$/i.test(lines[i])) {
        const parts = lines[i].split(/\s+/);
        if (parts.length >= 2) attrs.push({ name: parts[0], type: parts[1], pk: parts.some(p => /^pk$/i.test(p)) });
        i++;
      }
      entities.push({ name, attrs });
    } else if (/^RELACIONAMENTO\s+\S+/i.test(line)) {
      const name = line.replace(/^RELACIONAMENTO\s+/i,'').trim();
      let from = null, to = null;
      i++;
      while (i < lines.length && !/^FIM$/i.test(lines[i])) {
        const m1 = lines[i].match(/^DE\s+(\S+)\s+\(([^)]+)\)/i);
        const m2 = lines[i].match(/^PARA\s+(\S+)\s+\(([^)]+)\)/i);
        if (m1) from = { entity: m1[1], card: m1[2] };
        if (m2) to   = { entity: m2[1], card: m2[2] };
        i++;
      }
      if (from && to) relationships.push({ name, from, to });
    }
    i++;
  }
  return { entities, relationships };
}
