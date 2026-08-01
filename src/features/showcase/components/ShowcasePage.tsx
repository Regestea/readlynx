import { useState } from "react";
import type { ReactNode } from "react";
import {
  Bell,
  Bookmark,
  BookOpen,
  ChevronRight,
  Eye,
  EyeOff,
  Highlighter,
  Mail,
  NotebookPen,
  Plus,
} from "lucide-react";
import dayBackground from "../../../assets/backgrounds/day-background.png";
import { Avatar } from "../../../components/ui/Avatar/Avatar";
import { BookCard } from "../../../components/BookCard/BookCard";
import { Button } from "../../../components/ui/Button/Button";
import { Card } from "../../../components/ui/Card/Card";
import { Checkbox } from "../../../components/ui/Checkbox/Checkbox";
import { Code } from "../../../components/ui/Code/Code";
import { ColorSelect } from "../../../components/ui/ColorSelect/ColorSelect";
import { FileInput } from "../../../components/ui/FileInput/FileInput";
import { Image } from "../../../components/ui/Image/Image";
import { Input } from "../../../components/ui/Input/Input";
import { List } from "../../../components/ui/List/List";
import type { ListItemData } from "../../../components/ui/List/List";
import { Markdown } from "../../../components/ui/Markdown/Markdown";
import { MarkdownEditor } from "../../../components/ui/MarkdownEditor";
import { Modal } from "../../../components/ui/Modal/Modal";
import { Mermaid } from "../../../components/ui/Mermaid/Mermaid";
import { NumberInput } from "../../../components/ui/NumberInput/NumberInput";
import { Progress } from "../../../components/ui/Progress/Progress";
import { QuoteCard } from "../../../components/QuoteCard/QuoteCard";
import { SearchBar } from "../../../components/ui/SearchBar/SearchBar";
import { Select } from "../../../components/ui/Select/Select";
import type { SelectOption } from "../../../components/ui/Select/Select";
import { StatisticsCard } from "../../../components/StatisticsCard/StatisticsCard";
import { Table } from "../../../components/ui/Table/Table";
import type { TableColumn } from "../../../components/ui/Table/Table";
import { Tabs } from "../../../components/ui/Tabs/Tabs";
import type { TabItem } from "../../../components/ui/Tabs/Tabs";
import { TextArea } from "../../../components/ui/TextArea/TextArea";
import type { Book } from "../../../shared/types";
import {
  continueReadingBooks,
  dailyQuote,
  recommendedBooks,
  weekStats,
} from "../../home/data/mockData";
import styles from "./ShowcasePage.module.css";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps) {
  return (
    <Card className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && <p className={styles.sectionDesc}>{description}</p>}
      </div>
      {children}
    </Card>
  );
}

const GENRE_OPTIONS: SelectOption[] = [
  { value: "fiction", label: "Fiction" },
  { value: "non-fiction", label: "Non-fiction" },
  { value: "nature", label: "Nature" },
  { value: "history", label: "History" },
  { value: "philosophy", label: "Philosophy" },
  { value: "sci-fi", label: "Sci-Fi" },
];

const LIBRARY_ITEMS: ListItemData[] = [
  { id: "l1", icon: <BookOpen size={16} strokeWidth={1.8} />, label: "Nature Collection", description: "14 books", trailing: <ChevronRight size={16} strokeWidth={1.8} /> },
  { id: "l2", icon: <BookOpen size={16} strokeWidth={1.8} />, label: "Currently Reading", description: "3 books in progress", trailing: <ChevronRight size={16} strokeWidth={1.8} /> },
  { id: "l3", icon: <Bookmark size={16} strokeWidth={1.8} />, label: "Saved for Later", description: "8 books on the shelf", trailing: <ChevronRight size={16} strokeWidth={1.8} /> },
];

const NOTE_ITEMS: ListItemData[] = [
  { id: "n1", icon: <NotebookPen size={16} strokeWidth={1.8} />, label: "Chapter 12 — The root network", description: "Trees share resources through fungi…" },
  { id: "n2", icon: <NotebookPen size={16} strokeWidth={1.8} />, label: "Habit stacking idea", description: "Attach reading to morning coffee" },
];

const HIGHLIGHT_ITEMS: ListItemData[] = [
  { id: "h1", icon: <Highlighter size={16} strokeWidth={1.8} />, label: "“We read to know we are not alone.”", description: "C.S. Lewis · The Four Loves" },
  { id: "h2", icon: <Highlighter size={16} strokeWidth={1.8} />, label: "“The forest is a quiet community.”", description: "Peter Wohlleben · Hidden Life" },
];

const BOOKMARK_ITEMS: ListItemData[] = [
  { id: "m1", icon: <Bookmark size={16} strokeWidth={1.8} />, label: "Page 196 of 288", description: "The Hidden Life of Trees" },
  { id: "m2", icon: <Bookmark size={16} strokeWidth={1.8} />, label: "Page 207 of 391", description: "Braiding Sweetgrass" },
];

const DEMO_TABS: TabItem[] = [
  { id: "notes", label: "Notes", icon: <NotebookPen size={16} strokeWidth={1.8} />, content: <List items={NOTE_ITEMS} /> },
  { id: "highlights", label: "Highlights", icon: <Highlighter size={16} strokeWidth={1.8} />, content: <List items={HIGHLIGHT_ITEMS} /> },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark size={16} strokeWidth={1.8} />, content: <List items={BOOKMARK_ITEMS} /> },
];

const READING_FLOW: string = `
graph TD
  A[Pick a book] --> B{Genre?}
  B -->|Fiction| C[Read aloud]
  B -->|Nature| D[Take notes]
  C --> E[Highlight quotes]
  D --> E
  E --> F[Add to collection]
  F --> G(Finished)
`;

const SYNC_SEQUENCE: string = `
sequenceDiagram
  participant U as Reader
  participant L as Library
  participant C as Cloud
  U->>L: Open book
  L->>C: Fetch latest progress
  C-->>L: Page 196 of 288
  L-->>U: Resume reading
`;

const SAMPLE_TS_CODE: string = `
// محاسبهی سهماهه مطالعه — reading stats for this month
export function readingStreak(days: DayLog[]): number {
  let streak = 0;
  // اگر امروز هم خواندهاید، زنجیره را ادامه بدهید
  for (const day of days) {
    if (day.minutesRead > 0) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}
`;

const SAMPLE_CSS_CODE: string = `
.sidebar {
  width: var(--sidebar-width);
  transition: width 400ms ease;
  backdrop-filter: blur(var(--blur-glass));
}
`;

const SAMPLE_PERSIAN_CODE: string = `
// خواندن روزانه — ساخته شده با عشق
export function dailyGoal(minutes: number): string {
  // در یک روز عالی، حداقل سی دقیقه بخوانید
  return minutes >= 30 ? "عالی!" : "بیشتر بخوانید";
}
`;

const EDITOR_SAMPLE_MARKDOWN: string = `# Mountain Journal

A WYSIWYG editor on top of **Lexical** — this document is converted from Markdown when the page loads.

## What works

- Bold, *italic*, ~strikethrough~, \`inline code\` and ==highlights==
- [Links](https://lexical.dev) and checklists
- Fenced code blocks with syntax highlighting

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

> [!info]
> Try the File menu: export this document as Markdown, HTML or an EPUB book.

## Reading goals

| Book | Pages | Done |
| ---- | ----- | ---- |
| The Midnight Library | 320 | Yes |
| Persian Miniatures | 412 | No |

- [x] Read chapter one
- [ ] Write book summary
- [ ] Export the EPUB`;


const markdownSections: string[] = [
  `# 🚀 نمونه کامل Markdown

## تیترها

# Heading 1
## Heading 2
### Heading 3`,

  `## متن ساده

این یک متن معمولی است.

**متن بولد**

*متن ایتالیک*

***بولد و ایتالیک***

~~متن خط خورده~~

> این یک نقل قول است.`,

  `## لیست‌ها

### لیست نامرتب

- مورد اول
- مورد دوم
  - زیرمورد 1
  - زیرمورد 2

### لیست مرتب

1. آیتم اول
2. آیتم دوم
3. آیتم سوم

### Task List

- [x] یادگیری React
- [x] یادگیری .NET
- [ ] یادگیری AI`,

  `## لینک و تصویر

[OpenAI](https://openai.com)

![Sample Image](https://picsum.photos/300/150)`,

  `## جدول بزرگ نمونه

| ID | نام | نام خانوادگی | سن | جنسیت | شهر | کشور | شغل | سابقه کار | زبان اصلی | ایمیل | وضعیت |
|----|-----|--------------|----|--------|------|--------|------|-----------|------------|--------|--------|
| 1 | Amir | Mahmood Pour | 28 | Male | Tehran | Iran | .NET Developer | 5 Years | Persian | amir@example.com | Active |
| 2 | Sara | Ahmadi | 25 | Female | Shiraz | Iran | UI/UX Designer | 3 Years | Persian | sara@example.com | Active |
| 3 | Ali | Mohammadi | 30 | Male | Isfahan | Iran | DevOps Engineer | 7 Years | Persian | ali@example.com | Active |
| 4 | Reza | Karimi | 32 | Male | Tabriz | Iran | Backend Developer | 8 Years | Persian | reza@example.com | Inactive |
| 5 | Maryam | Hosseini | 27 | Female | Mashhad | Iran | Frontend Developer | 4 Years | Persian | maryam@example.com | Active |
| 6 | Nima | Ebrahimi | 29 | Male | Karaj | Iran | QA Engineer | 5 Years | Persian | nima@example.com | Active |
| 7 | Fatemeh | Jalali | 31 | Female | Ahvaz | Iran | Product Manager | 6 Years | Persian | fatemeh@example.com | Active |
| 8 | Arman | Rahimi | 26 | Male | Qom | Iran | Mobile Developer | 3 Years | Persian | arman@example.com | Pending |`,

  `## کد Inline

برای نصب پکیج از دستور \`npm install\` استفاده کنید.`,

  `## کد C#

\`\`\`csharp
using System;

public class Program
{
    public static void Main()
    {
        Console.WriteLine("Hello World");

        var numbers = new[] { 1, 2, 3, 4, 5 };

        var evenNumbers = numbers
            .Where(x => x % 2 == 0)
            .ToList();

        Console.WriteLine(string.Join(", ", evenNumbers));
    }
}
\`\`\``,

  `## کد TypeScript

\`\`\`ts
interface User {
    id: number;
    name: string;
}

const user: User = {
    id: 1,
    name: "Amir"
};

console.log(user);
\`\`\``,

  `## کد JSON

\`\`\`json
{
    "name": "Amir",
    "skills": [
        ".NET",
        "React",
        "Docker"
    ]
}
\`\`\``,

  `## فرمول‌های ریاضی (KaTeX / MathJax)

فرمول درون‌خطی:

$E = mc^2$

فرمول بلوکی:

$$
a^2 + b^2 = c^2
$$`,

  `## فرمول‌های پیشرفته

انتگرال:

$$
\\int_{0}^{1} x^2 dx = \\frac{1}{3}
$$

مشتق:

$$
\\frac{d}{dx}(x^2) = 2x
$$

ماتریس:

$$
\\begin{bmatrix}
1 & 2 \\\\
3 & 4
\\end{bmatrix}
$$`,

  `## فیزیک

قانون دوم نیوتن:

$$
F = ma
$$

قانون اهم:

$$
V = IR
$$

انرژی:

$$
E = mc^2
$$

گرانش:

$$
F = G \\frac{m_1 m_2}{r^2}
$$`,

  `## متن رنگی (HTML)

<span style="color:red">متن قرمز</span>

<span style="color:green">متن سبز</span>

<span style="color:blue">متن آبی</span>`,

  `## HTML داخل Markdown

<div style="padding:10px;border:1px solid gray;border-radius:8px;">
  این یک Box HTML است.
</div>`,

  `## جدول با ایموجی

| Skill | Level |
|---------|---------|
| C# | ⭐⭐⭐⭐⭐ |
| React | ⭐⭐⭐ |
| Docker | ⭐⭐⭐⭐ |
| Azure | ⭐⭐⭐ |`,

  `## Mermaid Diagram

\`\`\`mermaid
graph TD
A[Client] --> B[API]
B --> C[Database]
B --> D[Redis]
\`\`\``,

  `## نقل قول چند خطی

> Clean Architecture
>
> Dependency Inversion
>
> Domain Driven Design`,

  `پایان نمونه کامل Markdown 🎉`,
];

const TABLE_COLUMNS: TableColumn<Book>[] = [
  { key: "title", header: "Title", render: (book) => <span className={styles.cellTitle}>{book.title}</span> },
  { key: "author", header: "Author", render: (book) => book.author },
  { key: "category", header: "Category", render: (book) => book.category ?? "—" },
  {
    key: "progress",
    header: "Progress",
    align: "right",
    render: (book) =>
      typeof book.progress === "number" ? (
        <div className={styles.cellProgress}>
          <Progress value={book.progress} thickness={6} />
          <span>{Math.round(book.progress * 100)}%</span>
        </div>
      ) : (
        "—"
      ),
  },
];

const TABLE_ROWS: Book[] = [...continueReadingBooks, ...recommendedBooks];

export function ShowcasePage() {
  const [name, setName] = useState("");
  const [reading, setReading] = useState(0.35);
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState("");
  const [goal, setGoal] = useState(30);
  const [genre, setGenre] = useState("nature");
  const [prefs, setPrefs] = useState({ weekly: true, digest: false, suggestions: true });
  const [color, setColor] = useState("#5b6b50");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className={styles.page} aria-label="Component showcase">
      <div className={styles.intro}>
        <h1 className={styles.title}>Component Showcase</h1>
        <p className={styles.subtitle}>Every reusable UI component, live. This page is temporary.</p>
      </div>

      {/* ---------- Button ---------- */}
      <Section title="Button" description="Pill shape, soft gradients, lift on hover, press on click.">
        <div className={styles.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="icon" aria-label="Notifications">
            <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
          </Button>
          <Button variant="icon" aria-label="Add">
            <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </div>
      </Section>

      {/* ---------- Input + SearchBar ---------- */}
      <Section title="Input" description="Rounded, frosted glass, green focus glow. The name input drives the Avatar below.">
        <div className={styles.stack}>
          <Input placeholder="Default input" aria-label="Default input" />
          <Input
            placeholder="With a leading icon"
            aria-label="Email address"
            leading={<Mail size={18} strokeWidth={1.8} />}
          />
          <Input
            placeholder="Type a name, e.g. Avery Lane"
            aria-label="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="Password"
            aria-label="Password"
            type={showPassword ? "text" : "password"}
            trailing={
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff size={16} strokeWidth={1.8} />
                ) : (
                  <Eye size={16} strokeWidth={1.8} />
                )}
              </button>
            }
          />
          <SearchBar />
        </div>
      </Section>

      {/* ---------- TextArea ---------- */}
      <Section title="TextArea" description="Multi-line notes with the same glass language as Input.">
        <div className={styles.stack}>
          <TextArea
            placeholder="Write your reading notes here…"
            aria-label="Reading notes"
            rows={5}
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <p className={styles.charCount}>{notes.length} / 500</p>
        </div>
      </Section>

      {/* ---------- NumberInput ---------- */}
      <Section title="NumberInput" description="Stepper control for numeric values.">
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="goal-input" className={styles.fieldLabel}>
              Daily reading goal
            </label>
            <NumberInput
              id="goal-input"
              value={goal}
              min={5}
              max={240}
              step={5}
              onChange={setGoal}
              label="Daily reading goal in minutes"
            />
          </div>
          <p className={styles.demoHint}>
            Goal: <strong>{goal}</strong> min
          </p>
        </div>
      </Section>

      {/* ---------- Select ---------- */}
      <Section title="SelectInput" description="Native select, dressed in the theme.">
        <div className={styles.stack}>
          <Select
            options={GENRE_OPTIONS}
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
            aria-label="Book genre"
          />
          <p className={styles.demoHint}>
            Chosen genre: <strong>{GENRE_OPTIONS.find((option) => option.value === genre)?.label}</strong>
          </p>
        </div>
      </Section>

      {/* ---------- Card ---------- */}
      <Section title="Card" description="28px radius, glassmorphism, soft shadow. Two surface variants.">
        <div className={styles.row}>
          <Card className={styles.demoCard}>
            <p className={styles.demoLabel}>Card</p>
            <p className={styles.demoHint}>rgba(255,248,240,.72)</p>
          </Card>
          <Card variant="glass" className={styles.demoCard}>
            <p className={styles.demoLabel}>Glass</p>
            <p className={styles.demoHint}>rgba(255,250,245,.58)</p>
          </Card>
        </div>
      </Section>

      {/* ---------- Progress ---------- */}
      <Section title="Progress" description="Linear and circular, driven by the buttons below.">
        <div className={styles.stack}>
          <Progress value={0.25} />
          <Progress value={0.5} />
          <Progress value={0.75} />
          <Progress value={reading} />
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => setReading((value) => Math.min(1, value + 0.1))}>
              Read a chapter
            </Button>
            <Button variant="ghost" onClick={() => setReading(0.35)}>
              Reset
            </Button>
          </div>
          <div className={styles.row}>
            <Progress variant="circular" value={0.25} size={88} strokeWidth={8} />
            <Progress variant="circular" value={0.5} size={88} strokeWidth={8} />
            <Progress variant="circular" value={reading} size={88} strokeWidth={8} />
          </div>
        </div>
      </Section>

      {/* ---------- Avatar ---------- */}
      <Section title="Avatar" description="Gradient ring and initials. Follows the name typed above.">
        <div className={styles.row}>
          <Avatar name={name.trim() || "Avery Lane"} size={32} />
          <Avatar name={name.trim() || "Avery Lane"} size={40} />
          <Avatar name={name.trim() || "Avery Lane"} size={48} />
          <Avatar name={name.trim() || "Avery Lane"} size={64} />
        </div>
      </Section>

      {/* ---------- BookCard ---------- */}
      <Section title="BookCard" description="Generated gradient covers, vertical grid and horizontal row layouts.">
        <div className={styles.grid}>
          {recommendedBooks.slice(0, 3).map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
        <div className={styles.hScroll}>
          {continueReadingBooks.slice(0, 3).map((book) => (
            <BookCard key={book.id} book={book} layout="horizontal" />
          ))}
        </div>
      </Section>

      {/* ---------- List ---------- */}
      <Section title="List" description="ul/li list with icons, labels and trailing actions.">
        <div className={styles.stack}>
          <List items={LIBRARY_ITEMS} />
        </div>
      </Section>

      {/* ---------- Table ---------- */}
      <Section title="Table" description="Reading table with inline progress bars.">
        <Table columns={TABLE_COLUMNS} rows={TABLE_ROWS} />
      </Section>

      {/* ---------- Checkbox ---------- */}
      <Section title="Checkbox" description="Custom boxes, gradient when checked, focus visible ring.">
        <div className={styles.checkboxStack}>
          <Checkbox
            label="Email me weekly summaries"
            checked={prefs.weekly}
            onChange={(checked) => setPrefs((current) => ({ ...current, weekly: checked }))}
          />
          <Checkbox
            label="Send book suggestions"
            checked={prefs.digest}
            onChange={(checked) => setPrefs((current) => ({ ...current, digest: checked }))}
          />
          <Checkbox
            label="Share highlights automatically"
            checked={prefs.suggestions}
            onChange={(checked) => setPrefs((current) => ({ ...current, suggestions: checked }))}
          />
          <Checkbox label="Disabled option" checked={false} disabled onChange={() => {}} />
        </div>
      </Section>

      {/* ---------- Image ---------- */}
      <Section title="Image" description="Rounded frame with loading and fallback states.">
        <div className={styles.imageRow}>
          <Image src={dayBackground} alt="Mountain morning landscape" aspectRatio="3 / 2" className={styles.demoImage} />
          <Image alt="Missing image placeholder" aspectRatio="3 / 2" className={styles.demoImage} />
        </div>
      </Section>

      {/* ---------- FileInput ---------- */}
      <Section title="FileInput" description="Upload a cover, PDF or EPUB. Try it.">
        <div className={styles.stack}>
          <FileInput />
        </div>
      </Section>

      {/* ---------- ColorSelect ---------- */}
      <Section title="ColorSelect" description="Palette swatches plus a custom picker.">
        <div className={styles.stack}>
          <ColorSelect value={color} onChange={setColor} label="Accent color" />
          <div className={styles.colorPreview} style={{ background: color }}>
            <span className={styles.colorPreviewText}>{color}</span>
          </div>
        </div>
      </Section>

      {/* ---------- Tabs ---------- */}
      <Section title="Tabs" description="Pill tab list, keyboard arrows supported.">
        <Tabs tabs={DEMO_TABS} ariaLabel="Book tools" />
      </Section>

      {/* ---------- Modal ---------- */}
      <Section title="Modal" description="Dialog with blurred backdrop, Escape and outside click to close.">
        <div className={styles.row}>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Add a new book"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setModalOpen(false)}>Add book</Button>
            </>
          }
        >
          <Input placeholder="Book title" aria-label="Book title" />
          <Select options={GENRE_OPTIONS} aria-label="Book genre" />
          <NumberInput value={goal} min={1} max={2000} step={1} onChange={setGoal} label="Total pages" />
        </Modal>
      </Section>

      {/* ---------- Mermaid ---------- */}
      <Section title="Mermaid" description="Renders diagram source in the app theme.">
        <div className={styles.stack}>
          <Mermaid code={READING_FLOW} ariaLabel="Reading journey flowchart" />
          <Mermaid code={SYNC_SEQUENCE} ariaLabel="Reading progress sync sequence" />
        </div>
      </Section>

      {/* ---------- Code ---------- */}
      <Section title="Code" description="Prism syntax highlighting on the glass surface, following the theme. Persian and Arabic comments render with font fallback.">
        <div className={styles.stack}>
          <Code code={SAMPLE_TS_CODE} language="typescript" showLineNumbers />
          <Code code={SAMPLE_CSS_CODE} language="css" />
          <Code code={SAMPLE_PERSIAN_CODE} language="typescript" />
        </div>
      </Section>

      {/* ---------- Markdown ---------- */}
      <Section title="Markdown" description="Markdown rendered through the app's own components — Table, List, Code, Mermaid, Image — plus KaTeX math, raw HTML and task lists.">
        <div className={`${styles.stack} ${styles.stackFull}`}>
          {markdownSections.map((section, index) => (
            <Markdown key={index} content={section} />
          ))}
        </div>
      </Section>

      {/* ---------- MarkdownEditor ---------- */}
      <Section title="MarkdownEditor" description="WYSIWYG Lexical editor — edit rich content, then export Markdown, HTML or an EPUB 3 (XHTML + OPF) book from the File menu.">
        <div className={`${styles.stack} ${styles.stackFull}`}>
          <MarkdownEditor initialMarkdown={EDITOR_SAMPLE_MARKDOWN} />
        </div>
      </Section>

      {/* ---------- QuoteCard ---------- */}
      <Section title="QuoteCard" description="Daily quote widget.">
        <QuoteCard quote={dailyQuote} />
      </Section>

      {/* ---------- StatisticsCard ---------- */}
      <Section title="StatisticsCard" description="Weekly reading chart with CSS bars.">
        <StatisticsCard stats={weekStats} />
      </Section>
    </main>
  );
}
