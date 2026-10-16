#!/usr/bin/env python3
"""
用途：把三個知識來源切成 Mentor 的知識庫塊（chunks.jsonl）與自動評測題（eval_auto.jsonl）。

來源（依提案第三節的三層信任）：
  1. 教材倉庫 tw-ytp/vocabuddy：index.html（62 頁）、glossary.md、CHANGELOG.md
  2. Labs 倉庫 ytp26h2/ytp26h2-labs：labs/*/README.md、CHECKLIST.md、docs/ERRATA.md、docs/LAB_GUIDE.md、CLAUDE.md、程式碼
  3. 內部文件白名單：kb/internal/*.md（由主辦放入）

用法：
  python3 scripts/build_kb.py --vocabuddy ../vocabuddy --labs ../ytp26h2-labs --internal kb/internal --out kb

輸出：
  kb/chunks.jsonl       一行一塊：{id, source, tier, page_id, url, title, section, kind, lab, part, text, version, sha}
  kb/eval_auto.jsonl    從「常見錯誤急救」表與 ERRATA 自動產生的評測題
  kb/vocabuddy-pages.md 教材 62 頁純文字（階段 0：放進助教共用 Project 用）
  kb/manifest.json      版本、commit、塊數統計

零依賴，Python 3.9+。
"""
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

MAX_CHARS = 700          # 單塊字數上限（EmbeddingGemma 300m 上限 512 token，中文約 1 字 1 token，留餘裕）
MIN_CHARS = 80           # 太短的塊併到前一塊

SITE = "https://tw-ytp.github.io/vocabuddy/#/"
LABS_REPO = "https://github.com/ytp26h2/ytp26h2-labs/blob/main/"
VOCAB_REPO = "https://github.com/tw-ytp/vocabuddy/blob/main/"


# ---------------------------------------------------------------- HTML → text
class PageText(HTMLParser):
    """用途：把教材一頁的 HTML 轉成帶標題與表格記號的純文字（近似 Markdown）。"""

    SKIP = {"svg", "style", "script", "button", "select"}
    VOID = {"input", "img", "hr", "meta", "link"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0
        self.in_pre = False
        self.cell = []          # 目前表格列的儲存格
        self.in_cell = False
        self.tag_stack = []
        self.step_no = 0
        self.in_steps = False

    def _emit(self, s):
        if self.in_cell:
            self.cell[-1] += s
        else:
            self.out.append(s)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        if tag in self.SKIP:
            self.skip += 1
            return
        if self.skip or tag in self.VOID:
            return
        self.tag_stack.append((tag, cls))
        if tag == "h1":
            self._emit("\n# ")
        elif tag == "h2":
            self._emit("\n\n## ")
        elif tag in ("h3", "h4"):
            if self.in_steps and tag == "h4":
                self.step_no += 1
                self._emit(f"\n\n### 步驟 {self.step_no}：")
            else:
                self._emit("\n\n### ")
        elif tag == "ol" and "steps" in cls:
            self.in_steps = True
            self.step_no = 0
        elif tag == "pre":
            self.in_pre = True
            self._emit("\n```\n")
        elif tag == "code" and not self.in_pre:
            self._emit("`")
        elif tag == "br":
            self._emit("\n")
        elif tag == "li":
            if "check" in self._parent_cls():
                self._emit("\n- [ ] ")
            elif not self.in_steps or self._parent_tag() != "ol":
                self._emit("\n- ")
            else:
                self._emit("\n")
        elif tag == "tr":
            self.cell = []
        elif tag in ("td", "th"):
            self.cell.append("")
            self.in_cell = True
        elif tag == "table":
            self._emit("\n")
        elif tag == "div" and "stuckbox" in cls:
            self._emit("\n\n## 卡住了？\n")
        elif tag == "div" and any(k in cls for k in ("scene", "keybox", "warnbox", "quiz", "labmeta")):
            self._emit("\n\n")
        elif tag == "span" and cls == "lab":
            if not (self.tag_stack and len(self.tag_stack) > 1 and "stuckbox" in self.tag_stack[-2][1]):
                self._emit("【")
            else:
                self.skip += 1; self.tag_stack.pop()
        elif tag == "span" and cls == "p" and self.in_pre:
            pass
        elif tag == "figure":
            self._emit("\n\n")
        elif tag == "p":
            self._emit("\n")
        elif tag == "div" and cls in ("m", "qt", "exp"):
            self._emit("\n")
        elif tag == "label" and "opt" in cls:
            self._emit("\n  ○ ")

    def _parent_cls(self):
        for t, c in reversed(self.tag_stack[:-1]):
            if t in ("ul", "ol"):
                return c
        return ""

    def _parent_tag(self):
        for t, c in reversed(self.tag_stack[:-1]):
            if t in ("ul", "ol"):
                return t
        return ""

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            if self.skip:
                self.skip -= 1
            return
        if self.skip:
            if tag == "span" and self.skip == 1 and self.tag_stack and "stuckbox" in self.tag_stack[-1][1]:
                self.skip = 0
            return
        if tag in self.VOID:
            return
        if tag == "b" and self.tag_stack and self.tag_stack[-1][0] == "b" and len(self.tag_stack) > 1 and self.tag_stack[-2][1] == "m":
            self._emit("：")
        if tag == "span" and self.tag_stack and self.tag_stack[-1] == ("span", "lab"):
            self._emit("】")
        if self.tag_stack and self.tag_stack[-1][0] == tag:
            self.tag_stack.pop()
        else:
            for i in range(len(self.tag_stack) - 1, -1, -1):
                if self.tag_stack[i][0] == tag:
                    del self.tag_stack[i:]
                    break
        if tag == "pre":
            self.in_pre = False
            self._emit("\n```\n")
        elif tag == "code" and not self.in_pre:
            self._emit("`")
        elif tag in ("td", "th"):
            self.in_cell = False
        elif tag == "tr":
            if self.cell:
                row = " | ".join(re.sub(r"\s+", " ", c).strip() for c in self.cell)
                self.out.append("\n| " + row + " |")
            self.cell = []
        elif tag == "ol" and self.in_steps:
            self.in_steps = False
        elif tag in ("p", "li", "div", "h1", "h2", "h3", "h4", "figure", "label"):
            self._emit("\n")

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_pre:
            self._emit(data)
        else:
            self._emit(re.sub(r"[ \t\r\n]+", " ", data))

    def text(self):
        t = "".join(self.out)
        t = re.sub(r"【\s*([^】\n]{1,10}?)\s*】\s*", r"【\1】", t)
        t = re.sub(r"[ \t]+\n", "\n", t)
        t = re.sub(r"\n{3,}", "\n\n", t)
        return t.strip()


def page_sections(index_html):
    """用途：從 index.html 取出每一頁（section.page）的 id 與原始 HTML。"""
    pages = []
    for m in re.finditer(r'<section class="page" id="p-([^"]+)">(.*?)</section>', index_html, re.S):
        pages.append((m.group(1), m.group(2)))
    return pages


def page_meta(pid, raw):
    eyebrow = re.search(r'<div class="eyebrow">(.*?)</div>', raw, re.S)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S)
    strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip() if s else ""
    eb = strip(eyebrow.group(1) if eyebrow else "")
    title = strip(h1.group(1) if h1 else pid)
    lab = None
    m = re.search(r"\bLAB\s*(\d+)", eb, re.I) or re.search(r"^lab(\d+)$", pid)
    if m:
        lab = int(m.group(1))
    sprint = re.search(r"^3-(\d)$", pid)
    if sprint:   # Sprint 1–4 對應 Lab 5–8
        lab = 4 + int(sprint.group(1))
    part = re.split(r"[／/]", eb)[0].strip() if eb else ""
    if not part:
        part = {"home": "導讀", "cheat": "附錄 A", "fresh": "附錄 B", "gloss": "附錄 C", "guide": "附錄 D"}.get(pid, "")
    return eb, title, lab, part


KIND_BY_HEADING = [
    ("驗收清單", "checklist"),
    ("常見錯誤急救", "rescue"),
    ("卡住了", "rescue"),
    ("自我檢測", "quiz"),
    ("章節地圖", "map"),
]


def split_blocks(text):
    """用途：依 ## 與 ### 標題切成區塊，回傳 [(heading, body)]。"""
    parts = re.split(r"\n(?=## |### )", "\n" + text)
    blocks = []
    cur_h2 = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if p.startswith("## "):
            cur_h2 = p.split("\n", 1)[0][3:].strip()
            body = p.split("\n", 1)[1] if "\n" in p else ""
            blocks.append((cur_h2, body.strip()))
        elif p.startswith("### "):
            h3 = p.split("\n", 1)[0][4:].strip()
            body = p.split("\n", 1)[1] if "\n" in p else ""
            blocks.append(((cur_h2 + " › " if cur_h2 else "") + h3, body.strip()))
        else:
            blocks.append(("", p))
    return blocks


def split_long(body, limit=MAX_CHARS):
    """用途：把超長區塊在段落／表格列邊界切開，表格列不拆。"""
    if len(body) <= limit:
        return [body]
    units = []
    buf = []
    in_code = False
    for line in body.split("\n"):
        if line.startswith("```"):
            in_code = not in_code
            buf.append(line)
            if not in_code:
                units.append("\n".join(buf)); buf = []
            continue
        if in_code:
            buf.append(line); continue
        if line.strip() == "":
            if buf:
                units.append("\n".join(buf)); buf = []
            continue
        if line.startswith("| "):
            if buf and not buf[-1].startswith("| "):
                units.append("\n".join(buf)); buf = []
            units.append(line)
            continue
        buf.append(line)
    if buf:
        units.append("\n".join(buf))
    chunks, cur = [], ""
    for u in units:
        if len(u) > limit and not u.startswith("```") and not u.startswith("| "):
            # 超長段落：按句號切
            sents = re.split(r"(?<=[。！？；])", u)
            for s in sents:
                if len(cur) + len(s) > limit and cur:
                    chunks.append(cur); cur = ""
                cur += s
            continue
        if len(cur) + len(u) + 1 > limit and cur:
            chunks.append(cur); cur = u
        else:
            cur = (cur + "\n" + u) if cur else u
    if cur:
        chunks.append(cur)
    return [c.strip() for c in chunks if c.strip()]


def kind_of(heading, pid, body):
    for k, v in KIND_BY_HEADING:
        if k in heading:
            return v
    if pid.startswith("quiz") or body.lstrip().startswith("1．") or "○ " in body[:200]:
        return "quiz"
    if "【情境】" in body[:20]:
        return "scene"
    if "【核心觀念】" in body[:40] or "【地雷" in body[:40]:
        return "key"
    if heading.startswith("步驟") or " › 步驟" in heading:
        return "step"
    if pid == "fresh":
        return "fresh"
    if pid == "gloss":
        return "glossary"
    return "body"


def sha(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------- builders
def build_vocabuddy(root, version):
    chunks, evals, pages_md = [], [], []
    index_html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
    for pid, raw in page_sections(index_html):
        eb, title, lab, part = page_meta(pid, raw)
        p = PageText(); p.feed(raw)
        text = p.text()
        pages_md.append(f"\n\n---\n\n<!-- page: {pid} | {SITE}{pid} -->\n{text}")
        head = f"【{eb or part}】{title}"
        n = 0
        for heading, body in split_blocks(text):
            if heading == "":
                body = re.sub(r"^[^\n]*\n+# [^\n]*\n*", "", body, count=1) if "\n# " in body or body.startswith("# ") else body
                body = re.sub(r"^(上一頁|下一頁).*$", "", body, flags=re.M).strip()
            body = re.sub(r"\n(上一頁|下一頁)[^\n]*", "", body).strip()
            if not body:
                continue
            kind = kind_of(heading, pid, body)
            for piece in split_long(body):
                if len(piece) < MIN_CHARS and chunks and chunks[-1]["page_id"] == pid and chunks[-1]["kind"] == kind:
                    chunks[-1]["text"] += "\n" + piece
                    continue
                n += 1
                sec = heading
                chunks.append({
                    "id": f"vb:{pid}:{n}",
                    "source": "vocabuddy", "tier": 1,
                    "page_id": pid, "url": SITE + pid,
                    "title": title, "section": sec, "kind": kind,
                    "lab": lab, "part": part,
                    "text": f"{head}" + (f" — {sec}" if sec else "") + "\n" + piece,
                    "version": version,
                })
            # 自動評測：急救表每一列 = 一題
            if kind == "rescue":
                for mm in re.finditer(r"[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+?)——(.+?)(?=\n|$)", body):
                    evals.append({"q": mm.group(1).strip(), "expect_page_id": pid, "kind": "rescue", "note": mm.group(2)[:80]})
                for row in re.findall(r"^\| (.+?) \| (.+?) \|$", body, re.M):
                    q, a = row
                    if q in ("症狀", "狀況", "問題") or len(q) < 4:
                        continue
                    evals.append({"q": q, "expect_page_id": pid, "kind": "rescue", "note": a[:80]})
    # glossary.md：一條一塊
    g = open(os.path.join(root, "glossary.md"), encoding="utf-8").read()
    part = ""
    for line in g.split("\n"):
        if line.startswith("## "):
            part = line[3:].strip(); continue
        m = re.match(r"^\| (.+?) \| (.+?) \| (.+?) \| (.+) \|$", line)
        if m and m.group(1) not in ("術語", "---"):
            term, full, zh, expl = m.groups()
            chunks.append({
                "id": f"vb:gloss:{sha(term)}", "source": "vocabuddy", "tier": 1,
                "page_id": "gloss", "url": SITE + "gloss", "title": "詞彙表 Glossary",
                "section": part, "kind": "glossary", "lab": None, "part": "附錄 C",
                "text": f"【附錄 C 詞彙表・{part}】{term}（{full}；{zh}）：{expl}",
                "version": version,
            })
    # CHANGELOG.md：一版一塊（超長再切）
    c = open(os.path.join(root, "CHANGELOG.md"), encoding="utf-8").read()
    for m in re.finditer(r"\n## (v[\d.]+)[^\n]*\n(.*?)(?=\n## v|\Z)", c, re.S):
        ver, body = m.group(1), m.group(2).strip()
        for i, piece in enumerate(split_long(body, 900), 1):
            chunks.append({
                "id": f"vb:changelog:{ver}:{i}", "source": "vocabuddy", "tier": 1,
                "page_id": None, "url": VOCAB_REPO + "CHANGELOG.md", "title": f"教材版本沿革 {ver}",
                "section": ver, "kind": "changelog", "lab": None, "part": "CHANGELOG",
                "text": f"【教材 CHANGELOG・{ver}】\n{piece}", "version": version,
            })
    return chunks, evals, "".join(pages_md)


def md_blocks(md):
    """用途：Markdown 依標題切塊。"""
    parts = re.split(r"\n(?=#{1,3} )", "\n" + md)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if p.startswith("#"):
            h, _, body = p.partition("\n")
            out.append((h.lstrip("# ").strip(), body.strip()))
        else:
            out.append(("", p))
    return out


def build_labs(root, version):
    chunks, evals = [], []
    labs_dir = os.path.join(root, "labs")
    for d in sorted(os.listdir(labs_dir)):
        m = re.match(r"lab(\d\d)-", d)
        if not m:
            continue
        lab = int(m.group(1))
        for fn in ("README.md", "CHECKLIST.md"):
            fp = os.path.join(labs_dir, d, fn)
            if not os.path.exists(fp):
                continue
            md = open(fp, encoding="utf-8").read()
            n = 0
            for h, body in md_blocks(md):
                if not body:
                    continue
                for piece in split_long(body):
                    n += 1
                    chunks.append({
                        "id": f"labs:{d}:{fn}:{n}", "source": "labs", "tier": 2,
                        "page_id": f"lab{lab}", "url": LABS_REPO + f"labs/{d}/{fn}",
                        "title": f"ytp26h2-labs/{d}/{fn}", "section": h,
                        "kind": "checklist" if fn == "CHECKLIST.md" else "lab-readme",
                        "lab": lab, "part": "Labs 實作紀錄",
                        "text": f"【Labs 倉庫・Lab {lab}・{fn}】" + (f"{h}\n" if h else "\n") + piece,
                        "version": version,
                    })
        # 程式碼：.js / .py / .json / .md 以外的小檔，整檔或切段
        for fn in sorted(os.listdir(os.path.join(labs_dir, d))):
            if not re.search(r"\.(js|py|json|yml|txt)$", fn) or fn == "index.html":
                continue
            fp = os.path.join(labs_dir, d, fn)
            if os.path.getsize(fp) > 20000:
                continue
            code = open(fp, encoding="utf-8", errors="replace").read()
            for i, piece in enumerate(split_long("```\n" + code + "\n```", 1800), 1):
                chunks.append({
                    "id": f"labs:{d}:{fn}:code{i}", "source": "labs", "tier": 2,
                    "page_id": f"lab{lab}", "url": LABS_REPO + f"labs/{d}/{fn}",
                    "title": f"ytp26h2-labs/{d}/{fn}", "section": "程式碼", "kind": "code",
                    "lab": lab, "part": "Labs 實作紀錄",
                    "text": f"【Labs 倉庫・Lab {lab}・程式碼 {fn}】\n{piece}", "version": version,
                })
    # ERRATA：一條一塊
    e = open(os.path.join(root, "docs", "ERRATA.md"), encoding="utf-8").read()
    for line in e.split("\n"):
        m = re.match(r"^\| (E-\d{3}) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$", line)
        if not m:
            continue
        eid, where, orig, problem, fix, sev, status = m.groups()
        lab = None
        ml = re.search(r"Lab (\d+)", where) or re.search(r"Sprint (\d)（Lab (\d+)）", where)
        if ml:
            lab = int(ml.group(ml.lastindex))
        chunks.append({
            "id": f"labs:errata:{eid}", "source": "labs", "tier": 2,
            "page_id": f"lab{lab}" if lab else None, "url": LABS_REPO + "docs/ERRATA.md",
            "title": f"勘誤 {eid}", "section": where, "kind": "errata", "lab": lab, "part": "勘誤表",
            "text": f"【勘誤 {eid}・{where}・嚴重度 {sev}・{status}】\n原文：{orig}\n問題：{problem}\n修正：{fix}",
            "version": version, "errata_id": eid,
        })
        evals.append({"q": f"{orig} {problem[:120]}", "expect_errata": eid, "expect_page_id": f"lab{lab}" if lab else None, "kind": "errata"})
    # LAB_GUIDE.md、CLAUDE.md、.claude/*
    for rel in ("docs/LAB_GUIDE.md", "CLAUDE.md", ".claude/skills/add-words/SKILL.md", ".claude/agents/code-reviewer.md", "README.md"):
        fp = os.path.join(root, rel)
        if not os.path.exists(fp):
            continue
        md = open(fp, encoding="utf-8").read()
        n = 0
        for h, body in md_blocks(md):
            if not body:
                continue
            for piece in split_long(body):
                n += 1
                chunks.append({
                    "id": f"labs:{rel}:{n}", "source": "labs", "tier": 2,
                    "page_id": None, "url": LABS_REPO + rel, "title": f"ytp26h2-labs/{rel}",
                    "section": h, "kind": "labs-doc", "lab": None, "part": "Labs 實作紀錄",
                    "text": f"【Labs 倉庫・{rel}】" + (f"{h}\n" if h else "\n") + piece, "version": version,
                })
    return chunks, evals


def build_internal(root, version):
    chunks = []
    if not root or not os.path.isdir(root):
        return chunks
    for fn in sorted(os.listdir(root)):
        if not fn.endswith(".md") or fn.upper() == "README.MD":
            continue
        md = open(os.path.join(root, fn), encoding="utf-8").read()
        title = fn[:-3]
        n = 0
        for h, body in md_blocks(md):
            if not body:
                continue
            for piece in split_long(body):
                n += 1
                chunks.append({
                    "id": f"int:{sha(fn)}:{n}", "source": "internal", "tier": 3,
                    "page_id": None, "url": None, "title": title, "section": h, "kind": "internal",
                    "lab": None, "part": "主辦內部文件",
                    "text": f"【主辦內部文件・{title}】" + (f"{h}\n" if h else "\n") + piece, "version": version,
                })
    return chunks


def build_faq(root, version):
    """用途：kb/faq/*.md 一檔一題，公開的主辦補充問答（第 2 層，檢索高加權）。"""
    chunks = []
    if not root or not os.path.isdir(root):
        return chunks
    for fn in sorted(os.listdir(root)):
        if not fn.endswith(".md") or fn.upper() == "README.MD":
            continue
        md = open(os.path.join(root, fn), encoding="utf-8").read()
        m = re.match(r"^#\s+(.+)", md)
        title = m.group(1).strip() if m else fn[:-3]
        body = md[m.end():].strip() if m else md
        for i, piece in enumerate(split_long(body, 1200), 1):
            chunks.append({
                "id": f"faq:{sha(fn)}:{i}", "source": "faq", "tier": 2,
                "page_id": None, "url": f"https://github.com/tw-ytp/vocabuddy-mentor/blob/main/kb/faq/{fn}",
                "title": f"補充問答：{title}", "section": "", "kind": "faq", "lab": None, "part": "主辦補充問答",
                "text": f"【主辦補充問答】{title}\n{piece}", "version": version,
            })
    return chunks


def git_rev(root):
    try:
        return subprocess.check_output(["git", "-C", root, "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocabuddy", required=True)
    ap.add_argument("--labs", required=True)
    ap.add_argument("--internal", default="kb/internal")
    ap.add_argument("--faq", default="kb/faq")
    ap.add_argument("--out", default="kb")
    a = ap.parse_args()

    readme = open(os.path.join(a.vocabuddy, "README.md"), encoding="utf-8").read()
    mv = re.search(r"教材版本 (v[\d.]+)", readme)
    version = mv.group(1) if mv else "unknown"

    c1, e1, pages_md = build_vocabuddy(a.vocabuddy, version)
    c2, e2 = build_labs(a.labs, version)
    c3 = build_internal(a.internal, version)
    c4 = build_faq(a.faq, version)
    chunks = c1 + c2 + c3 + c4
    for c in chunks:
        c["sha"] = sha(c["text"])
    evals = e1 + e2

    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "chunks.jsonl"), "w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out, "eval_auto.jsonl"), "w", encoding="utf-8") as f:
        for e in evals:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    with open(os.path.join(a.out, "vocabuddy-pages.md"), "w", encoding="utf-8") as f:
        f.write(f"# YTP VocaBuddy 開發者之路 {version}・全頁純文字（供助教共用 Project 檢索）\n"
                f"教材網址：{SITE[:-2]}　每頁開頭的 page 註解就是深連結尾碼。\n" + pages_md)
    stats = {}
    for c in chunks:
        k = f"{c['source']}/{c['kind']}"
        stats[k] = stats.get(k, 0) + 1
    manifest = {
        "version": version,
        "vocabuddy_commit": git_rev(a.vocabuddy), "labs_commit": git_rev(a.labs),
        "chunks": len(chunks), "evals": len(evals), "by_kind": stats,
        "max_chars": max(len(c["text"]) for c in chunks),
    }
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
