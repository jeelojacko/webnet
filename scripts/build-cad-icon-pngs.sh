#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
src_root="${1:-$repo_root/local-assets/acad-icons}"
out_root="${2:-$repo_root/local-assets/generated-cad-icons}"
agents_file="$repo_root/local-assets/AGENTS.md"

if ! command -v magick >/dev/null 2>&1; then
    echo "ERROR: ImageMagick 'magick' command not found."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found."
    exit 1
fi

if [[ ! -d "$src_root" ]]; then
    echo "ERROR: Source directory does not exist:"
    echo "  $src_root"
    exit 1
fi

echo "Source:"
echo "  $src_root"
echo
echo "Output:"
echo "  $out_root"
echo

rm -rf "$out_root"

mkdir -p \
    "$out_root/dark" \
    "$out_root/light" \
    "$out_root/tool-palettes" \
    "$out_root/other-xmx"

sanitize_name() {
    local s="$1"

    s="${s//\\/ }"
    s="${s//\// }"
    s="${s//&/ and }"

    s="$(
        printf '%s' "$s" |
        sed -E '
            s/[[:space:]]+/ /g;
            s/^[[:space:]]+//;
            s/[[:space:]]+$//;
            s/ /_/g;
            s/[^A-Za-z0-9._-]+/_/g;
            s/_+/_/g;
            s/^_+//;
            s/_+$//
        '
    )"

    printf '%s\n' "$s"
}

size_folder() {
    local w="$1"
    local h="$2"

    if [[ "$w" == "$h" ]]; then
        printf '%s\n' "$w"
    else
        printf '%sx%s\n' "$w" "$h"
    fi
}

preferred_core_family() {
    local size="$1"

    if [[ "$size" =~ ^[0-9]+$ ]] && (( size <= 24 )); then
        printf '16\n'
    else
        printf '32\n'
    fi
}

identify_pages() {
    local src="$1"

    magick identify \
        -format '%p %w %h\n' \
        "$src" \
        2>/dev/null || true
}

unique_destination() {
    local dest="$1"

    if [[ ! -e "$dest" ]]; then
        printf '%s\n' "$dest"
        return
    fi

    local stem="${dest%.*}"
    local ext="${dest##*.}"
    local n=2

    while [[ -e "${stem}__${n}.${ext}" ]]; do
        ((n++))
    done

    printf '%s\n' "${stem}__${n}.${ext}"
}

convert_core() {
    local theme="$1"
    local dir="$2"

    [[ -d "$dir" ]] || return

    echo
    echo "============================================================"
    echo "Core $theme icons"
    echo "  $dir"
    echo "============================================================"

    find "$dir" \
        -maxdepth 1 \
        -type f \
        \( \
            -iname '*.tif' -o \
            -iname '*.tiff' -o \
            -iname '*.ico' -o \
            -iname '*.png' -o \
            -iname '*.bmp' -o \
            -iname '*.webp' \
        \) \
        -print0 |
    sort -z |
    while IFS= read -r -d '' src; do

        file="$(basename "$src")"
        base="${file%.*}"

        if [[ "$base" =~ ^(16|32)_(.+)$ ]]; then
            family="${BASH_REMATCH[1]}"
            raw_name="${BASH_REMATCH[2]}"
        else
            family="other"
            raw_name="$base"
        fi

        name="$(sanitize_name "$raw_name")"

        while read -r page w h; do
            [[ -n "${page:-}" ]] || continue

            size="$(size_folder "$w" "$h")"

            dest_dir="$out_root/$theme/$size"
            mkdir -p "$dest_dir"

            if [[ "$family" == "16" || "$family" == "32" ]]; then

                alt="$dest_dir/${name}__from${family}.png"

                magick \
                    "${src}[$page]" \
                    "PNG32:$alt" \
                    2>/dev/null || {
                        echo "FAILED: $src page $page"
                        continue
                    }

                preferred="$(preferred_core_family "$size")"
                canonical="$dest_dir/${name}.png"

                if [[ "$family" == "$preferred" ]]; then
                    cp -f "$alt" "$canonical"
                elif [[ ! -e "$canonical" ]]; then
                    cp -f "$alt" "$canonical"
                fi

            else

                dest="$dest_dir/${name}.png"

                if [[ "$page" != "0" ]]; then
                    dest="$dest_dir/${name}__p${page}.png"
                fi

                magick \
                    "${src}[$page]" \
                    "PNG32:$dest" \
                    2>/dev/null || \
                    echo "FAILED: $src page $page"
            fi

        done < <(identify_pages "$src")

    done
}

choose_palette_dir() {
    if [[ -d "$src_root/tool-palettes-v3" ]]; then
        printf '%s\n' "$src_root/tool-palettes-v3"
    elif [[ -d "$src_root/tool-palettes-v2" ]]; then
        printf '%s\n' "$src_root/tool-palettes-v2"
    elif [[ -d "$src_root/tool-palettes" ]]; then
        printf '%s\n' "$src_root/tool-palettes"
    fi
}

normalized_palette_directory() {
    local relative_dir="$1"

    local theme=""
    local -a kept=()

    IFS='/' read -ra pieces <<< "$relative_dir"

    for part in "${pieces[@]}"; do

        [[ "$part" == "." ]] && continue

        lower="${part,,}"

        case "$lower" in
            light)
                theme="light"
                continue
                ;;
            dark)
                theme="dark"
                continue
                ;;
            default|images|image|icons|icon)
                continue
                ;;
            en-us|en_us|enu)
                continue
                ;;
        esac

        kept+=("$part")
    done

    local category=""

    if (( ${#kept[@]} == 0 )); then
        category="Misc"
    else
        local first=1

        for part in "${kept[@]}"; do
            if (( first )); then
                category="$part"
                first=0
            else
                category="$category/$part"
            fi
        done
    fi

    if [[ -n "$theme" ]]; then
        printf '%s|%s\n' "$category" "$theme"
    else
        printf '%s|\n' "$category"
    fi
}

convert_tool_palettes() {
    local palettes_dir
    palettes_dir="$(choose_palette_dir || true)"

    [[ -n "${palettes_dir:-}" ]] || return
    [[ -d "$palettes_dir" ]] || return

    echo
    echo "============================================================"
    echo "Civil 3D / Autodesk Tool Palette icons"
    echo "  $palettes_dir"
    echo "============================================================"

    find "$palettes_dir" \
        -type f \
        \( \
            -iname '*.png' -o \
            -iname '*.jpg' -o \
            -iname '*.jpeg' -o \
            -iname '*.bmp' -o \
            -iname '*.tif' -o \
            -iname '*.tiff' -o \
            -iname '*.ico' -o \
            -iname '*.webp' \
        \) \
        -print0 |
    sort -z |
    while IFS= read -r -d '' src; do

        rel="${src#$palettes_dir/}"
        rel_dir="$(dirname "$rel")"

        mapping="$(normalized_palette_directory "$rel_dir")"

        category="${mapping%%|*}"
        theme="${mapping#*|}"

        dest_dir="$out_root/tool-palettes/$category"

        if [[ -n "$theme" ]]; then
            dest_dir="$dest_dir/$theme"
        fi

        mkdir -p "$dest_dir"

        file="$(basename "$src")"
        raw_name="${file%.*}"

        # v3 already contains useful human-readable names,
        # so preserve them rather than rewriting them.
        name="$raw_name"

        while read -r page w h; do
            [[ -n "${page:-}" ]] || continue

            dest="$dest_dir/${name}.png"

            if [[ "$page" != "0" ]]; then
                dest="$dest_dir/${name}__p${page}.png"
            fi

            dest="$(unique_destination "$dest")"

            magick \
                "${src}[$page]" \
                "PNG32:$dest" \
                2>/dev/null || \
                echo "FAILED: $src page $page"

        done < <(identify_pages "$src")

    done
}

convert_other_xmx_archives() {
    echo
    echo "============================================================"
    echo "Other extracted XMX archives"
    echo "============================================================"

    find "$src_root" \
        -mindepth 1 \
        -maxdepth 1 \
        -type d \
        -print0 |
    sort -z |
    while IFS= read -r -d '' archive_dir; do

        source_name="$(basename "$archive_dir")"

        case "$source_name" in
            acadbtn|acadbtn_light|tool-palettes|tool-palettes-v2|tool-palettes-v3|xmx|generated-cad-icons)
                continue
                ;;
        esac

        image_count="$(
            find "$archive_dir" \
                -type f \
                \( \
                    -iname '*.png' -o \
                    -iname '*.jpg' -o \
                    -iname '*.jpeg' -o \
                    -iname '*.bmp' -o \
                    -iname '*.tif' -o \
                    -iname '*.tiff' -o \
                    -iname '*.ico' -o \
                    -iname '*.webp' \
                \) |
            wc -l
        )"

        (( image_count > 0 )) || continue

        echo "  -> $source_name ($image_count source files)"

        find "$archive_dir" \
            -type f \
            \( \
                -iname '*.png' -o \
                -iname '*.jpg' -o \
                -iname '*.jpeg' -o \
                -iname '*.bmp' -o \
                -iname '*.tif' -o \
                -iname '*.tiff' -o \
                -iname '*.ico' -o \
                -iname '*.webp' \
            \) \
            -print0 |
        sort -z |
        while IFS= read -r -d '' src; do

            file="$(basename "$src")"
            base="${file%.*}"

            if [[ "$base" =~ ^(16|32)_(.+)$ ]]; then
                family="${BASH_REMATCH[1]}"
                raw_name="${BASH_REMATCH[2]}"
            else
                family=""
                raw_name="$base"
            fi

            name="$(sanitize_name "$raw_name")"

            while read -r page w h; do
                [[ -n "${page:-}" ]] || continue

                size="$(size_folder "$w" "$h")"

                dest_dir="$out_root/other-xmx/$source_name/$size"
                mkdir -p "$dest_dir"

                if [[ -n "$family" ]]; then
                    dest="$dest_dir/${name}__from${family}.png"
                else
                    dest="$dest_dir/${name}.png"
                fi

                if [[ "$page" != "0" ]]; then
                    dest="${dest%.png}__p${page}.png"
                fi

                dest="$(unique_destination "$dest")"

                magick \
                    "${src}[$page]" \
                    "PNG32:$dest" \
                    2>/dev/null || \
                    echo "FAILED: $src page $page"

            done < <(identify_pages "$src")

        done
    done
}

generate_inventory() {
    echo
    echo "============================================================"
    echo "Generating icons.json + AGENTS.md"
    echo "============================================================"

    python3 - "$out_root" "$agents_file" <<'PY'
from pathlib import Path
from collections import Counter
import json
import re
import sys

out_root = Path(sys.argv[1]).resolve()
agents_file = Path(sys.argv[2]).resolve()

pngs = sorted(
    out_root.rglob("*.png"),
    key=lambda p: p.relative_to(out_root).as_posix().lower()
)

def natural_key(value):
    parts = re.split(r"(\d+)", str(value))
    return [
        int(part) if part.isdigit() else part.lower()
        for part in parts
    ]

icons = []

for p in pngs:
    rel = p.relative_to(out_root)
    parts = rel.parts

    record = {
        "name": p.stem,
        "path": rel.as_posix(),
    }

    top = parts[0] if parts else ""

    if top in {"dark", "light"}:
        record["kind"] = "core-command"
        record["theme"] = top

        if len(parts) >= 3:
            record["size"] = parts[1]

    elif top == "tool-palettes":
        record["kind"] = "tool-palette"

        if len(parts) >= 3:
            record["catalog"] = parts[1]

        if "light" in parts[1:-1]:
            record["theme"] = "light"
        elif "dark" in parts[1:-1]:
            record["theme"] = "dark"

        category_parts = [
            part
            for part in parts[1:-1]
            if part not in {"light", "dark"}
        ]

        if category_parts:
            record["category_path"] = "/".join(category_parts)

    elif top == "other-xmx":
        record["kind"] = "other-xmx"

        if len(parts) >= 4:
            record["source"] = parts[1]
            record["size"] = parts[2]

    else:
        record["kind"] = top or "unknown"

    icons.append(record)

dark_sizes = sorted(
    {
        x.get("size")
        for x in icons
        if x.get("kind") == "core-command"
        and x.get("theme") == "dark"
        and x.get("size")
    },
    key=natural_key,
)

light_sizes = sorted(
    {
        x.get("size")
        for x in icons
        if x.get("kind") == "core-command"
        and x.get("theme") == "light"
        and x.get("size")
    },
    key=natural_key,
)

palette_catalogs = sorted(
    {
        x.get("catalog")
        for x in icons
        if x.get("kind") == "tool-palette"
        and x.get("catalog")
    },
    key=str.lower,
)

xmx_sources = sorted(
    {
        x.get("source")
        for x in icons
        if x.get("kind") == "other-xmx"
        and x.get("source")
    },
    key=str.lower,
)

kind_counts = Counter(x["kind"] for x in icons)

manifest = {
    "description": (
        "Machine-readable inventory of locally generated Autodesk/Civil 3D "
        "CAD icon assets."
    ),
    "root": ".",
    "total_icons": len(icons),
    "counts": dict(sorted(kind_counts.items())),
    "core_dark_sizes": dark_sizes,
    "core_light_sizes": light_sizes,
    "tool_palette_catalogs": palette_catalogs,
    "other_xmx_sources": xmx_sources,
    "icons": icons,
}

manifest_path = out_root / "icons.json"

manifest_path.write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

lines = []

lines.append("# Local CAD Icon Assets")
lines.append("")
lines.append(
    "This directory contains local-only Autodesk / AutoCAD / Civil 3D "
    "icon resources used while developing WebNet's CAD interface."
)
lines.append("")
lines.append(
    "**These assets are intentionally local and gitignored. Do not add, "
    "commit, publish, or redistribute extracted Autodesk assets as part "
    "of the WebNet repository.**"
)
lines.append("")

lines.append("## Important paths")
lines.append("")
lines.append("- `acad-icons/` — raw extracted source assets.")
lines.append(
    "- `generated-cad-icons/` — normalized PNG assets intended for local "
    "development and icon selection."
)
lines.append(
    "- `generated-cad-icons/icons.json` — complete machine-readable "
    "inventory of every generated PNG."
)
lines.append(
    "- `../scripts/build-cad-icon-pngs.sh` — rebuilds the generated icon "
    "tree and this inventory."
)
lines.append("")

lines.append("## Generated file structure")
lines.append("")
lines.append("### Core CAD command icons")
lines.append("")
lines.append(
    "`generated-cad-icons/dark/<size>/` and "
    "`generated-cad-icons/light/<size>/` contain the main AutoCAD / "
    "Civil CAD command icon set."
)
lines.append("")
lines.append(
    "These cover the vast majority of ordinary CAD and survey/Civil "
    "actions: drawing, editing, geometry, annotation, layers, inquiry, "
    "modify operations, and related commands."
)
lines.append("")
lines.append(
    "Icons are grouped first by dark/light UI theme and then by their "
    "actual pixel size."
)
lines.append("")
lines.append(
    "For icons originating from Autodesk's logical `16_` and `32_` "
    "families, both source variants are preserved as `__from16` and "
    "`__from32`. A simple canonical filename such as `TRIM.png` is also "
    "provided. Prefer the canonical filename unless a specific source "
    "family is required."
)
lines.append("")

lines.append("Available dark sizes:")
lines.append("")
lines.append(
    "- " + ", ".join(f"`{x}`" for x in dark_sizes)
    if dark_sizes
    else "- none"
)
lines.append("")

lines.append("Available light sizes:")
lines.append("")
lines.append(
    "- " + ", ".join(f"`{x}`" for x in light_sizes)
    if light_sizes
    else "- none"
)
lines.append("")

lines.append("### Civil 3D tool-palette graphics")
lines.append("")
lines.append(
    "`generated-cad-icons/tool-palettes/` contains the more specialized "
    "Civil 3D / Autodesk tool-palette images."
)
lines.append("")
lines.append(
    "Unlike the core command icons, these are organized by their source "
    "catalog/category rather than by resolution. This is intentional: "
    "the semantic category is more useful than the image dimensions."
)
lines.append("")
lines.append(
    "Typical content includes subassemblies, lanes, shoulders, curbs, "
    "daylight components, grading objects, road assemblies, retaining "
    "wall items, rail items, and other Civil 3D-specific graphics."
)
lines.append("")
lines.append(
    "If a source catalog provides explicit `light` and `dark` versions, "
    "those remain as `light/` and `dark/` subfolders beneath that "
    "catalog. If a source has no theme, the PNG files live directly "
    "inside the catalog/category folder; there is deliberately no "
    "`default/` directory."
)
lines.append("")

if palette_catalogs:
    lines.append("Top-level tool-palette catalogs currently available:")
    lines.append("")
    for catalog in palette_catalogs:
        lines.append(f"- `{catalog}`")
    lines.append("")

lines.append("### Other extracted XMX resources")
lines.append("")
lines.append(
    "`generated-cad-icons/other-xmx/` contains extracted images from "
    "additional Autodesk XMX resource archives that are neither the main "
    "`acadbtn` command set nor Civil 3D tool-palette catalogs."
)
lines.append("")
lines.append(
    "These remain grouped by source archive and pixel size so their "
    "provenance is not lost."
)
lines.append("")

if xmx_sources:
    lines.append("Currently available XMX source groups:")
    lines.append("")
    for source in xmx_sources:
        lines.append(f"- `{source}`")
    lines.append("")

lines.append("## Instructions for AI/coding agents")
lines.append("")
lines.append(
    "1. Search `generated-cad-icons/icons.json` before assuming that an "
    "icon exists. It is the authoritative inventory."
)
lines.append(
    "2. For ordinary CAD commands, search the `dark` and `light` trees. "
    "Prefer a canonical filename such as `MOVE.png`, `LINE.png`, or "
    "`TRIM.png`."
)
lines.append(
    "3. Match the UI theme when possible, and select the closest suitable "
    "pixel size for the rendered control."
)
lines.append(
    "4. For Civil 3D-specific concepts such as subassemblies, grading, "
    "curbs, lanes, daylight, road assemblies, shoulders, rail, etc., "
    "search `tool-palettes/` first."
)
lines.append(
    "5. Do not assume an icon exists in every size or both themes. Check "
    "`icons.json` for the exact available paths."
)
lines.append(
    "6. Do not rename or modify the raw `acad-icons/` extraction. "
    "Generated output can always be rebuilt from it."
)
lines.append(
    "7. Do not move these local Autodesk-derived assets into tracked "
    "application/public folders or commit them to the repository."
)
lines.append(
    "8. If WebNet needs a distributable/public icon later, create or use "
    "an appropriately licensed replacement rather than publishing the "
    "local Autodesk-derived source asset."
)
lines.append("")

lines.append("## Current inventory")
lines.append("")
lines.append(f"- Total generated PNGs: **{len(icons):,}**")
lines.append(
    f"- Core command icons: **{kind_counts.get('core-command', 0):,}**"
)
lines.append(
    f"- Tool-palette icons: **{kind_counts.get('tool-palette', 0):,}**"
)
lines.append(
    f"- Other XMX icons: **{kind_counts.get('other-xmx', 0):,}**"
)
lines.append("")
lines.append(
    "This inventory is regenerated by "
    "`scripts/build-cad-icon-pngs.sh`."
)
lines.append("")

agents_file.write_text(
    "\n".join(lines),
    encoding="utf-8",
)

print(f"Wrote {manifest_path}")
print(f"Wrote {agents_file}")
PY
}

summary() {
    echo
    echo "============================================================"
    echo "DONE"
    echo "============================================================"
    echo

    printf 'Core dark PNGs:   '
    find "$out_root/dark" \
        -type f \
        -iname '*.png' |
        wc -l

    printf 'Core light PNGs:  '
    find "$out_root/light" \
        -type f \
        -iname '*.png' |
        wc -l

    printf 'Tool palette PNGs: '
    find "$out_root/tool-palettes" \
        -type f \
        -iname '*.png' |
        wc -l

    printf 'Other XMX PNGs:   '
    find "$out_root/other-xmx" \
        -type f \
        -iname '*.png' |
        wc -l

    printf 'TOTAL PNGs:       '
    find "$out_root" \
        -type f \
        -iname '*.png' |
        wc -l

    echo
    echo "Generated:"
    echo "  $out_root/icons.json"
    echo "  $agents_file"
    echo
    echo "Output root:"
    echo "  $out_root"
}

convert_core "dark" "$src_root/acadbtn"
convert_core "light" "$src_root/acadbtn_light"

convert_tool_palettes
convert_other_xmx_archives

generate_inventory
summary