// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

import fs from 'node:fs';
import path from 'node:path';

import type {
  ComponentFileIndexItem,
  ComponentMetadata,
  DesignSystemIndex,
  GuidelineSection,
  IndexStats,
  PropDefinition,
  TokenMetadata,
} from './types.js';

/**
 * Semantic token categories derived from the token NAME
 * (--mds-<segment>-...), not from the CSS filename. The filename is the
 * THEME (light, dark, ...); categorising by it produced a single
 * meaningless "light" category and left every category-keyed behaviour
 * (best practices, declaration examples, the category filter) dead.
 */
const CATEGORY_BY_SEGMENT: Record<string, string> = {
  color: 'colors',
  bg: 'colors',
  text: 'colors',
  stroke: 'colors',
  border: 'borders',
  spacing: 'spacing',
  offset: 'spacing',
  scale: 'sizes',
  typography: 'typography',
  font: 'typography',
  line: 'typography',
  shadow: 'shadows',
  breakpoints: 'breakpoints',
};

export class DesignSystemIndexer {
  private readonly designSystemPath: string;
  private componentIndex = new Map<string, ComponentMetadata>();
  private tokenIndex = new Map<string, TokenMetadata>();
  private guidelineIndex = new Map<string, GuidelineSection>();
  private tokensLoadedFrom: string | null = null;
  private lastIndexed = '';

  constructor(designSystemPath: string) {
    this.designSystemPath = designSystemPath;
  }

  async index(): Promise<DesignSystemIndex> {
    this.componentIndex = this.loadComponents();
    this.tokenIndex = this.loadTokens();
    this.guidelineIndex = this.loadGuidelines();
    this.lastIndexed = new Date().toISOString();

    return {
      components: Object.fromEntries(this.componentIndex),
      tokens: Object.fromEntries(this.tokenIndex),
      lastIndexed: this.lastIndexed,
      version: '1.1.0',
    };
  }

  /** Compact data-state block included in tool responses so a broken or
   *  partial build is visible to the caller instead of silent. */
  getStats(): IndexStats {
    return {
      componentCount: this.componentIndex.size,
      tokenCount: this.tokenIndex.size,
      themes: Array.from(
        new Set(
          Array.from(this.tokenIndex.values()).map((token) => token.theme),
        ),
      ).sort(),
      tokensLoadedFrom: this.tokensLoadedFrom,
      guidelineCount: this.guidelineIndex.size,
      guidelineSources: Array.from(
        new Set(
          Array.from(this.guidelineIndex.values()).map(
            (section) => section.source,
          ),
        ),
      ).sort(),
      lastIndexed: this.lastIndexed,
    };
  }

  /** Ranked search over guideline sections: breadcrumb-title matches
   *  first, then body occurrences. */
  searchGuidelines(query: string, source?: string): GuidelineSection[] {
    const needle = query.trim().toLowerCase();
    const wantedSource = source?.trim().toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);

    return Array.from(this.guidelineIndex.values())
      .map((section) => {
        if (wantedSource && section.source !== wantedSource) {
          return { section, score: 0 };
        }
        const title = section.title.toLowerCase();
        const text = section.text.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (title.includes(term)) {
            score += 10;
          }
          const occurrences = text.split(term).length - 1;
          score += Math.min(occurrences, 5);
        }
        return { section, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.section);
  }

  getGuideline(id: string): GuidelineSection | undefined {
    return (
      this.guidelineIndex.get(id) ??
      this.guidelineIndex.get(id.trim().toLowerCase())
    );
  }

  /** Near-miss guideline ids for a failed lookup. */
  suggestGuidelines(id: string, limit = 5): string[] {
    const parts = id
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length >= 3);
    if (parts.length === 0) {
      return [];
    }
    return Array.from(this.guidelineIndex.values())
      .map((section) => ({
        id: section.id,
        overlap: parts.filter((part) => section.id.includes(part)).length,
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((entry) => entry.id);
  }

  private loadGuidelines(): Map<string, GuidelineSection> {
    const dir = path.join(this.designSystemPath, '.github', 'instructions');
    const result = new Map<string, GuidelineSection>();
    if (!fs.existsSync(dir)) {
      return result;
    }

    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.instructions.md'));

    for (const fileName of files) {
      const source = fileName.replace(/\.instructions\.md$/, '');
      const raw = fs.readFileSync(path.join(dir, fileName), 'utf8');
      for (const section of splitGuidelineSections(source, raw)) {
        // Duplicate breadcrumbs (repeated page structures) get a
        // numeric suffix so every section stays addressable.
        let id = section.id;
        let counter = 2;
        while (result.has(id)) {
          id = `${section.id}-${counter}`;
          counter += 1;
        }
        result.set(id, { ...section, id });
      }
    }

    return result;
  }

  /** Ranked search: name matches beat description matches beat
   *  category/token matches; results come back ordered, best first. */
  searchComponents(query: string): ComponentMetadata[] {
    const needle = query.trim().toLowerCase();

    return Array.from(this.componentIndex.values())
      .map((component) => {
        let score = 0;
        if (component.name.toLowerCase().includes(needle)) {
          score += 10;
        }
        if (component.description.toLowerCase().includes(needle)) {
          score += 5;
        }
        if ((component.category ?? '').toLowerCase().includes(needle)) {
          score += 2;
        }
        if (
          (component.relatedTokens ?? []).some((token) =>
            token.toLowerCase().includes(needle),
          )
        ) {
          score += 1;
        }
        return { component, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.component);
  }

  getComponent(name: string): ComponentMetadata | undefined {
    const exact = this.componentIndex.get(name);
    if (exact) {
      return exact;
    }

    const normalizedName = normalizeComponentName(name);
    return Array.from(this.componentIndex.values()).find(
      (component) => normalizeComponentName(component.name) === normalizedName,
    );
  }

  getAllComponents(): ComponentMetadata[] {
    return Array.from(this.componentIndex.values());
  }

  /** Ranked: token-name matches first, then value/category matches. */
  searchTokens(query: string, category?: string): TokenMetadata[] {
    const needle = query.trim().toLowerCase();
    const normalizedCategory = category?.trim().toLowerCase();

    return Array.from(this.tokenIndex.values())
      .map((token) => {
        if (
          normalizedCategory &&
          token.category.toLowerCase() !== normalizedCategory
        ) {
          return { token, score: 0 };
        }
        let score = 0;
        if (token.name.toLowerCase().includes(needle)) {
          score += 10;
        }
        if (token.value.toLowerCase().includes(needle)) {
          score += 3;
        }
        if (token.category.toLowerCase().includes(needle)) {
          score += 1;
        }
        return { token, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.token);
  }

  getToken(name: string): TokenMetadata | undefined {
    const exact = this.tokenIndex.get(name);
    if (exact) {
      return exact;
    }

    const normalizedName = normalizeTokenName(name);
    return Array.from(this.tokenIndex.values()).find(
      (token) =>
        normalizeTokenName(token.name) === normalizedName ||
        normalizeTokenName(token.cssVariable) === normalizedName,
    );
  }

  /** Near-miss candidates for a failed lookup - shared-substring match
   *  on the normalized name, best-overlap first. */
  suggestTokens(name: string, limit = 5): string[] {
    const normalized = normalizeTokenName(name).replace(/^mds-/, '');
    const parts = normalized.split('-').filter((part) => part.length >= 3);
    if (parts.length === 0) {
      return [];
    }

    return Array.from(this.tokenIndex.values())
      .map((token) => ({
        name: token.name,
        overlap: parts.filter((part) => token.name.includes(part)).length,
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit)
      .map((entry) => entry.name);
  }

  getTokensByCategory(category: string): TokenMetadata[] {
    const normalizedCategory = category.trim().toLowerCase();

    return Array.from(this.tokenIndex.values()).filter(
      (token) => token.category.toLowerCase() === normalizedCategory,
    );
  }

  getTokenCategories(): string[] {
    return Array.from(
      new Set(
        Array.from(this.tokenIndex.values()).map((token) => token.category),
      ),
    ).sort();
  }

  findComponentsUsingToken(tokenName: string): ComponentMetadata[] {
    const normalizedName = normalizeTokenName(tokenName);

    return Array.from(this.componentIndex.values()).filter((component) =>
      (component.relatedTokens ?? []).some(
        (token) => normalizeTokenName(token) === normalizedName,
      ),
    );
  }

  private loadComponents(): Map<string, ComponentMetadata> {
    const indexFromFile = this.loadComponentsFromDistIndex();
    if (indexFromFile.size > 0) {
      return indexFromFile;
    }

    return this.loadComponentsFromSource();
  }

  private loadComponentsFromDistIndex(): Map<string, ComponentMetadata> {
    const filePath = path.join(
      this.designSystemPath,
      'dist',
      'component-index.json',
    );
    if (!fs.existsSync(filePath)) {
      return new Map();
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw) as { components?: ComponentFileIndexItem[] };
    const result = new Map<string, ComponentMetadata>();

    for (const item of data.components ?? []) {
      const component = this.buildComponentMetadata(item);
      result.set(component.name, component);
    }

    return result;
  }

  private loadComponentsFromSource(): Map<string, ComponentMetadata> {
    const componentsDir = path.join(this.designSystemPath, 'components');
    if (!fs.existsSync(componentsDir)) {
      return new Map();
    }

    const entries = fs.readdirSync(componentsDir, { withFileTypes: true });
    const result = new Map<string, ComponentMetadata>();

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'assets') {
        continue;
      }

      const component = this.buildComponentMetadata({
        name: titleCaseFromSlug(entry.name),
        slug: entry.name,
        exportPath: `components/${entry.name}`,
        implementationPath: this.findFirstExisting([
          path.join(
            componentsDir,
            entry.name,
            `${titleCaseFromSlug(entry.name)}.tsx`,
          ),
          path.join(componentsDir, entry.name, 'index.tsx'),
        ]),
        storyPath: this.findFirstExisting([
          path.join(
            componentsDir,
            entry.name,
            `${titleCaseFromSlug(entry.name)}.stories.tsx`,
          ),
        ]),
        testPath: this.findFirstExisting([
          path.join(
            componentsDir,
            entry.name,
            `${titleCaseFromSlug(entry.name)}.test.tsx`,
          ),
        ]),
        figmaPath: this.findFirstExisting([
          path.join(
            componentsDir,
            entry.name,
            `${titleCaseFromSlug(entry.name)}.figma.tsx`,
          ),
        ]),
        cssPath: this.findFirstExisting([
          path.join(componentsDir, entry.name, `${entry.name}.css`),
        ]),
      });

      result.set(component.name, component);
    }

    return result;
  }

  private buildComponentMetadata(
    item: ComponentFileIndexItem,
  ): ComponentMetadata {
    const implementationPath = this.resolveRepoPath(item.implementationPath);
    const storyPath = this.resolveRepoPath(item.storyPath);
    const cssPath = this.resolveRepoPath(item.cssPath);

    const implementationSource = implementationPath
      ? safeReadFile(implementationPath)
      : '';
    const storySource = storyPath ? safeReadFile(storyPath) : '';
    const cssSource = cssPath ? safeReadFile(cssPath) : '';
    const combinedSource = [implementationSource, storySource, cssSource]
      .filter(Boolean)
      .join('\n');

    // The curated one-line purpose from the component index is the best
    // description we have; only fall back to source scraping without it.
    // The JSDoc fallback must be a block attached to an export - the
    // first /** ... */ in the file is usually a PROP's doc comment,
    // which produced wrong descriptions (Tooltip described as its
    // label prop).
    const description =
      item.purpose ||
      extractComponentJsDoc(implementationSource) ||
      extractComponentJsDoc(storySource) ||
      `Component source for ${item.name}.`;

    return {
      name: item.name,
      displayName: item.name,
      description,
      props: extractPropsFromSource(implementationSource),
      accessibility: extractAccessibilityNotes(
        storySource,
        implementationSource,
      ),
      examples: extractExamples(storySource),
      relatedTokens: extractRelatedTokens(combinedSource),
      category: inferCategory(item.slug),
      status: 'ready',
      implementationPath: implementationPath
        ? path.relative(this.designSystemPath, implementationPath)
        : undefined,
      storyPath: storyPath
        ? path.relative(this.designSystemPath, storyPath)
        : undefined,
      cssPath: cssPath
        ? path.relative(this.designSystemPath, cssPath)
        : undefined,
    };
  }

  private loadTokens(): Map<string, TokenMetadata> {
    // dist/tokens/css is only populated by a full `vite build`; the
    // much more common `npm run build-tokens` writes tokens/css at the
    // repo root. Reading only dist/ silently produced ZERO tokens on
    // any checkout without a full build (a real support case: every
    // token tool returned "not found" and nothing disclosed why).
    const candidates = [
      path.join(this.designSystemPath, 'dist', 'tokens', 'css'),
      path.join(this.designSystemPath, 'tokens', 'css'),
    ];
    const tokensDir = candidates.find((dir) => fs.existsSync(dir));
    if (!tokensDir) {
      this.tokensLoadedFrom = null;
      return new Map();
    }
    this.tokensLoadedFrom = path.relative(this.designSystemPath, tokensDir);

    const result = new Map<string, TokenMetadata>();
    const files = fs
      .readdirSync(tokensDir)
      .filter((fileName) => fileName.endsWith('.css'));

    for (const fileName of files) {
      // The filename is the THEME (light, dark, ...), not a category.
      const theme = path.basename(fileName, '.css');
      if (theme === 'index') {
        continue;
      }

      const source = fs.readFileSync(path.join(tokensDir, fileName), 'utf8');
      const matches = source.matchAll(/(--mds-[\w-]+)\s*:\s*([^;]+);/g);

      for (const match of matches) {
        const cssVariable = match[1];
        const value = match[2].trim();
        const name = cssVariable.replace(/^--/, '');

        // Same token in several theme files: keep the first (light is
        // built first); a future multi-theme index should key by
        // theme+name instead of silently overwriting.
        if (!result.has(name)) {
          result.set(name, {
            name,
            category: categoryFromTokenName(name),
            theme,
            value,
            cssVariable,
          });
        }
      }
    }

    return result;
  }

  private resolveRepoPath(filePath?: string): string | undefined {
    if (!filePath) {
      return undefined;
    }

    return path.isAbsolute(filePath)
      ? filePath
      : path.join(this.designSystemPath, filePath);
  }

  private findFirstExisting(filePaths: string[]): string | undefined {
    return filePaths.find((filePath) => fs.existsSync(filePath));
  }
}

function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function categoryFromTokenName(name: string): string {
  const segment = name.replace(/^mds-/, '').split('-')[0];
  return CATEGORY_BY_SEGMENT[segment] ?? segment;
}

/** JSDoc block directly attached to an exported declaration - the
 *  component's own doc, not the first prop's. */
function extractComponentJsDoc(source: string): string | undefined {
  const match = source.match(
    /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:const|function|class)\s+/,
  );
  if (!match) {
    return undefined;
  }

  const description = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line && !line.startsWith('@'))
    .join(' ')
    .trim();

  return description || undefined;
}

function extractPropsFromSource(source: string): PropDefinition[] {
  // [^{]* allows `extends OtherProps<...>` clauses - every component
  // uses one, and requiring `{` immediately made props [] for all of
  // them.
  const interfaceMatch = source.match(
    /export\s+interface\s+\w+Props[^{]*{([\s\S]*?)\n}/,
  );
  if (!interfaceMatch) {
    return [];
  }

  const lines = interfaceMatch[1].split('\n');
  const props: PropDefinition[] = [];
  let pendingDoc: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) {
      continue;
    }
    if (line.startsWith('/**') || line.startsWith('*')) {
      const text = line
        .replace(/^\/?\*+\/?/, '')
        .replace(/\*\/$/, '')
        .trim();
      if (text) {
        pendingDoc.push(text);
      }
      continue;
    }

    const propMatch = line.match(/^([A-Za-z0-9_]+)(\?)?:\s*([^;]+);?/);
    if (propMatch) {
      props.push({
        name: propMatch[1],
        required: propMatch[2] !== '?',
        type: propMatch[3].trim(),
        description: pendingDoc.length ? pendingDoc.join(' ') : undefined,
      });
    }
    pendingDoc = [];
  }

  return props;
}

/** Real story source per example, not a "see the source" pointer - the
 *  slice from one `export const X` to the next export (or EOF), capped. */
function extractExamples(
  source: string,
): Array<{ title: string; code: string; description?: string }> {
  const MAX_EXAMPLE_CHARS = 900;
  const matches = Array.from(
    source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*[:=]/g),
  );

  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? source.length)
        : source.length;
    let code = source.slice(start, end).trim();
    if (code.length > MAX_EXAMPLE_CHARS) {
      code = `${code.slice(0, MAX_EXAMPLE_CHARS)}\n// ... trimmed`;
    }
    return { title: match[1], code };
  });
}

function extractAccessibilityNotes(...sources: string[]): string[] {
  const combined = sources.join('\n').toLowerCase();
  const notes = new Set<string>();

  if (combined.includes('aria-')) {
    notes.add('ARIA attributes are referenced in source.');
  }
  if (combined.includes('keyboard')) {
    notes.add('Keyboard behavior is mentioned in source.');
  }
  if (combined.includes('screen reader')) {
    notes.add('Screen reader support is mentioned in source.');
  }

  return Array.from(notes);
}

function extractRelatedTokens(source: string): string[] {
  return Array.from(new Set(source.match(/--mds-[\w-]+/g) ?? [])).sort();
}

function inferCategory(slug: string): string {
  if (slug.includes('button')) {
    return 'Actions';
  }
  if (
    slug.includes('input') ||
    slug.includes('checkbox') ||
    slug.includes('radio')
  ) {
    return 'Forms';
  }
  if (
    slug.includes('nav') ||
    slug.includes('pagination') ||
    slug.includes('link')
  ) {
    return 'Navigation';
  }

  return 'Components';
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Split a guideline markdown document into heading-delimited sections
 *  with breadcrumb titles ("Button > Anatomy") - headings like
 *  "Anatomy" repeat across pages, so the breadcrumb is what makes a
 *  section identifiable and addressable. */
function splitGuidelineSections(
  source: string,
  raw: string,
): GuidelineSection[] {
  const lines = raw.split('\n');
  const sections: GuidelineSection[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let bodyLines: string[] = [];

  const flush = () => {
    const text = cleanGuidelineText(bodyLines.join('\n'));
    bodyLines = [];
    if (!text || text.length < 40 || stack.length === 0) {
      return;
    }
    const breadcrumb = stack.map((entry) => entry.title).join(' > ');
    const slug = breadcrumb
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    sections.push({
      id: `${source}:${slug}`,
      source,
      title: breadcrumb,
      text,
    });
  };

  for (const line of lines) {
    // Page markers written by build-docs (`<!-- page: Button -->`)
    // root the breadcrumb, because the in-page headings are generic
    // tab names ("Design", "Usage") repeated on every page.
    const pageMarker = line.match(/^<!--\s*page:\s*(.+?)\s*-->$/);
    if (pageMarker) {
      flush();
      stack.length = 0;
      stack.push({ level: 0, title: pageMarker[1] });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, title: heading[2].trim() });
    } else {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

/** Strip generator noise (HTML comments, ZeroHeight image references,
 *  shortcut-tile blocks) that carries no guidance. */
function cleanGuidelineText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<shortcut_tiles>[\s\S]*?<\/shortcut_tiles>/g, '')
    .replace(/!\[[^\]]*\]\(zeroheight:[^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeComponentName(value: string): string {
  return value.replace(/[\s_-]+/g, '').toLowerCase();
}

function normalizeTokenName(value: string): string {
  return value.replace(/^--/, '').toLowerCase();
}
