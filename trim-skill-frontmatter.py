import os

skills_dir = r"C:\Users\sdses\Desktop\Skills-kimi-register"
skills = [
    "role-data", "role-design", "role-engineering", "role-governance",
    "role-growth", "role-investor-docs", "role-meta", "role-office",
    "role-product", "role-research"
]

for skill in skills:
    path = os.path.join(skills_dir, skill, "SKILL.md")
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    # Find frontmatter boundaries: first two lines that are exactly "---"
    dash_indices = [i for i, line in enumerate(lines) if line.strip() == "---"]
    if len(dash_indices) < 2:
        print(f"{skill}: SKIP - cannot find frontmatter boundaries")
        continue
    
    start = dash_indices[0]   # first ---
    end = dash_indices[1]     # second ---
    
    frontmatter_lines = lines[start+1:end]
    
    # Extract name line
    name_line = None
    for line in frontmatter_lines:
        if line.strip().startswith("name:"):
            name_line = line.rstrip() + "\n"
            break
    
    # Extract description block
    desc_content = []
    in_desc = False
    for line in frontmatter_lines:
        stripped = line.rstrip()
        if stripped.startswith("description:"):
            in_desc = True
            rest = stripped[len("description:"):].strip()
            # If description is inline (not block scalar), capture it
            if rest and not rest.startswith(">-") and not rest.startswith(">") and not rest.startswith("|"):
                desc_content.append(rest)
            continue
        
        if in_desc:
            # Block scalar continuation: lines indented by at least 2 spaces
            if line.startswith("  ") or line.startswith("\t"):
                desc_content.append(line[2:].rstrip())
            elif line.strip() == "":
                # Empty line: might be inside block scalar; keep it
                desc_content.append("")
            else:
                # Non-indented, non-empty line -> end of description
                break
    
    # Trim trailing empty lines from description
    while desc_content and desc_content[-1] == "":
        desc_content.pop()
    
    if not name_line or not desc_content:
        print(f"{skill}: SKIP - failed to extract name/description")
        continue
    
    # Build new frontmatter
    new_fm = ["---\n", name_line, "description: >-\n"]
    for piece in desc_content:
        if piece == "":
            new_fm.append("\n")
        else:
            new_fm.append("  " + piece + "\n")
    new_fm.append("---\n")
    
    # Body: everything after the second ---
    body_lines = lines[end+1:]
    
    # Backup original
    bak_path = path + ".bak"
    with open(bak_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    
    # Write trimmed file
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(new_fm)
        f.writelines(body_lines)
    
    old_lines = end - start + 1
    new_lines = len(new_fm)
    print(f"{skill}: OK ({old_lines} -> {new_lines} lines in frontmatter)")

print("\nDone.")
