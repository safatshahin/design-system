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

export interface PropDefinition {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: string;
}

export interface ComponentExample {
  title: string;
  code: string;
  description?: string;
}

export interface ComponentMetadata {
  name: string;
  displayName: string;
  description: string;
  props: PropDefinition[];
  accessibility?: string[];
  examples?: ComponentExample[];
  relatedTokens?: string[];
  category?: string;
  status?: 'ready' | 'beta' | 'deprecated';
  implementationPath?: string;
  storyPath?: string;
  cssPath?: string;
}

export interface TokenMetadata {
  name: string;
  category: string;
  /** Theme file the token came from (e.g. "light"). */
  theme: string;
  value: string;
  cssVariable: string;
  description?: string;
  deprecated?: boolean;
  replacedBy?: string;
}

export interface ComponentFileIndexItem {
  name: string;
  slug: string;
  /** Curated one-line "when to use" guidance from the component index. */
  purpose?: string;
  exportPath: string;
  implementationPath?: string;
  storyPath?: string;
  testPath?: string;
  figmaPath?: string;
  cssPath?: string;
}

/** One heading-delimited section of a guideline document under
 *  .github/instructions/ (design guidance generated from ZeroHeight,
 *  plus the hand-written contributor guides). */
export interface GuidelineSection {
  /** Stable lookup id: "<source>:<breadcrumb-slug>". */
  id: string;
  /** Source document short name, e.g. "design-system" or "tokens". */
  source: string;
  /** Breadcrumb of headings, e.g. "Button > Anatomy". */
  title: string;
  text: string;
}

export interface IndexStats {
  componentCount: number;
  tokenCount: number;
  themes: string[];
  tokensLoadedFrom: string | null;
  guidelineCount: number;
  guidelineSources: string[];
  lastIndexed: string;
}

export interface DesignSystemIndex {
  components: Record<string, ComponentMetadata>;
  tokens: Record<string, TokenMetadata>;
  lastIndexed: string;
  version: string;
}
