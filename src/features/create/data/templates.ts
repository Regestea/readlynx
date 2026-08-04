import type { CoverStyle } from "../../../shared/types";

export interface BookTemplate {
  id: string;
  name: string;
  description: string;
  cover: CoverStyle;
  initialMarkdown: string;
}

export interface CreateBookDetails {
  template: BookTemplate;
  title: string;
  coverSrc: string | null;
  coverWidth: number | null;
}

export const BOOK_TEMPLATES: BookTemplate[] = [
  {
    id: "blank",
    name: "Blank Book",
    description: "Start with an empty page",
    cover: "sand",
    initialMarkdown: "",
  },
  {
    id: "novel",
    name: "Novel",
    description: "Chapter-based fiction scaffold",
    cover: "forest",
    initialMarkdown: `## Chapter One

Start writing here — each chapter becomes a new section of your book.

## Chapter Two

`,
  },
  {
    id: "journal",
    name: "Journal",
    description: "Dated entries, ready to fill",
    cover: "moon",
    initialMarkdown: `# Journal

## Entry

Write today's entry here.

`,
  },
  {
    id: "poetry",
    name: "Poetry",
    description: "Open verse pages",
    cover: "navy",
    initialMarkdown: `# Title of the Poem

Begin your poem here.

`,
  },
  {
    id: "children",
    name: "Children's Book",
    description: "A story with simple chapters",
    cover: "terracotta",
    initialMarkdown: `# My Story

Once upon a time...

## The Beginning

## The Adventure

## The End

`,
  },
  {
    id: "nonfiction",
    name: "Non-fiction",
    description: "Structured chapters for ideas",
    cover: "moss",
    initialMarkdown: `# Chapter One

Start writing your first chapter here.

## Chapter Two

`,
  },
];
