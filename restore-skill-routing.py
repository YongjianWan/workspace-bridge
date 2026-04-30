import os
import re

skills_dir = r"C:\Users\sdses\Desktop\Skills-kimi-register"
skills = [
    "role-data", "role-design", "role-engineering", "role-governance",
    "role-growth", "role-investor-docs", "role-meta", "role-office",
    "role-product", "role-research"
]

def extract_from_bak(bak_lines):
    dash_indices = [i for i, line in enumerate(bak_lines) if line.strip() == "---"]
    if len(dash_indices) < 2:
        return None, None, None
    fm_lines = bak_lines[dash_indices[0]+1:dash_indices[1]]
    
    # child_skill_directories
    csd = {}
    in_csd = False
    for line in fm_lines:
        if line.strip().startswith("child_skill_directories:"):
            in_csd = True
            continue
        if in_csd:
            if line.startswith("  ") and ":" in line:
                key, val = line.split(":", 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                csd[key] = val
            elif line.strip() == "":
                continue
            else:
                break
    
    # routing_priority
    rp = []
    in_rp = False
    for line in fm_lines:
        if line.strip().startswith("routing_priority:"):
            in_rp = True
            continue
        if in_rp:
            m = re.match(r'^\s+-\s+"(.*)"\s*$', line)
            if m:
                rp.append(m.group(1))
            elif line.strip() == "":
                continue
            else:
                break
    
    # expected_outputs
    eo = []
    in_eo = False
    for line in fm_lines:
        if line.strip().startswith("expected_outputs:"):
            in_eo = True
            continue
        if in_eo:
            m = re.match(r'^\s+-\s+(.*)\s*$', line)
            if m:
                val = m.group(1).strip().strip('"').strip("'")
                eo.append(val)
            elif line.strip() == "":
                continue
            else:
                break
    
    return csd, rp, eo

for skill in skills:
    bak_path = os.path.join(skills_dir, skill, "SKILL.md.bak")
    skill_path = os.path.join(skills_dir, skill, "SKILL.md")
    
    with open(bak_path, "r", encoding="utf-8") as f:
        bak_lines = f.readlines()
    
    csd, rp, eo = extract_from_bak(bak_lines)
    if not csd and not rp and not eo:
        print(f"{skill}: nothing to restore")
        continue
    
    with open(skill_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    # Find # Title line
    title_idx = None
    for i, line in enumerate(lines):
        if line.startswith("# "):
            title_idx = i
            break
    
    if title_idx is None:
        print(f"{skill}: no title found")
        continue
    
    # Find first ## line after title
    first_h2_idx = None
    for i in range(title_idx + 1, len(lines)):
        if lines[i].startswith("## "):
            first_h2_idx = i
            break
    
    insert_lines = []
    
    if csd:
        insert_lines.append("\n## 子技能目录\n\n")
        insert_lines.append("| 子技能 | 说明 |\n")
        insert_lines.append("|--------|------|\n")
        for k, v in csd.items():
            # Escape pipe in value to avoid breaking markdown table
            v_esc = v.replace("|", "\\|")
            insert_lines.append(f"| {k} | {v_esc} |\n")
        insert_lines.append("\n")
    
    if rp:
        insert_lines.append("## 路由优先级\n\n")
        for item in rp:
            insert_lines.append(f"- {item}\n")
        insert_lines.append("\n")
    
    if eo:
        insert_lines.append("## 预期产出\n\n")
        for item in eo:
            insert_lines.append(f"- {item}\n")
        insert_lines.append("\n")
    
    insert_pos = first_h2_idx if first_h2_idx is not None else title_idx + 1
    new_lines = lines[:insert_pos] + insert_lines + lines[insert_pos:]
    
    with open(skill_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    
    parts = []
    if csd: parts.append(f"CSD({len(csd)})")
    if rp: parts.append(f"RP({len(rp)})")
    if eo: parts.append(f"EO({len(eo)})")
    print(f"{skill}: restored {' + '.join(parts)}")

print("\nDone.")
