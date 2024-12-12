interface TidyResult {
	content: string;
	title?: string;
	excerpt?: string;
}

interface ElementMetrics {
	element: Element;
	textDensity: number;
	visualDensity: number;
	linkDensity: number;
	naturalLanguageScore: number;
	siblingSimilarity: number;
	contentMomentum: number;
}

/**
 * Scoring system for content detection
 * Each metric is weighted and combined to determine if an element contains valuable content
 */
const SCORING_WEIGHTS = {
	// Text-rich elements with minimal markup score higher
	TEXT_DENSITY: 1.5,

	// Dense text areas (like paragraphs) score higher than sparse ones (like navigation)
	VISUAL_DENSITY: 1.0,

	// Elements with fewer links score higher (1 - linkDensity)
	LINK_DENSITY: 1.0,

	// Natural language patterns (sentences, punctuation) score highest
	NATURAL_LANGUAGE: 2.0,

	// Some similarity to siblings suggests content sections
	SIBLING_SIMILARITY: 0.5,

	// Content indicators like paragraphs and figures boost score
	CONTENT_MOMENTUM: 1.0
} as const;

// Total of all weights, used for normalization
const TOTAL_WEIGHTS = Object.values(SCORING_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Minimum score (0-1) required for an element to be considered content
 * Current threshold requires elements to score at least 50% of maximum possible score
 */
const MINIMUM_CONTENT_SCORE = 0.5;

/**
 * Score decay factor for consecutive elements
 * Each subsequent element must score at least 70% of the previous element's score
 */
const SCORE_DECAY_FACTOR = 0.7;

export class Tidy {
	private static readonly BLOCK_ELEMENTS = new Set([
		'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'DD', 
		'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 
		'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LI', 
		'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
	]);

	private static readonly UNLIKELY_CANDIDATES = /banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|foot|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i;

	private static readonly POSITIVE_CANDIDATES = /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i;

	private static readonly CONTENT_BOUNDARY_INDICATORS = /more|related|popular|recommended|trending|similar|also|read|next|prev|suggested/i;

	private static readonly PAYWALL_INDICATORS = /sign[- ]?up|subscribe|membership|register|create[- ]account|log[- ]?in|sign[- ]?in|already[- ]have[- ]an[- ]account|continue reading|read more|full story|unlock|premium/i;

	private static readonly AUTH_BUTTONS = /google|facebook|twitter|email|apple|continue|social/i;

	/**
	 * Main entry point - extracts the main content from a document
	 */
	public static parse(doc: Document): TidyResult {
		// Get all block-level elements
		const blockElements = this.getBlockElements(doc.body);
		
		// Calculate metrics for each element
		const elementMetrics = blockElements.map(element => this.calculateMetrics(element));

		// Find the most promising content blocks
		const contentElements = this.findContentElements(elementMetrics);

		// Extract and clean the content
		const content = this.extractContent(contentElements);

		return {
			content,
			title: this.findTitle(doc),
			excerpt: this.generateExcerpt(content)
		};
	}

	/**
	 * Gets all block-level elements that might contain content
	 */
	private static getBlockElements(root: Element): Element[] {
		const elements: Element[] = [];
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode: (node: Element) => {
					if (!this.BLOCK_ELEMENTS.has(node.tagName)) {
						return NodeFilter.FILTER_SKIP;
					}
					if (this.isHidden(node)) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				}
			}
		);

		let node: Element | null;
		while (node = walker.nextNode() as Element) {
			elements.push(node);
		}

		return elements;
	}

	/**
	 * Calculates various metrics for an element to determine if it's content
	 */
	private static calculateMetrics(element: Element): ElementMetrics {
		return {
			element,
			textDensity: this.getTextDensity(element),
			visualDensity: this.getVisualDensity(element),
			linkDensity: this.getLinkDensity(element),
			naturalLanguageScore: this.getNaturalLanguageScore(element),
			siblingSimilarity: this.getSiblingSimilarity(element),
			contentMomentum: this.getContentMomentum(element)
		};
	}

	/**
	 * Calculates text density (ratio of text to HTML)
	 */
	private static getTextDensity(element: Element): number {
		const text = element.textContent || '';
		const html = element.innerHTML;
		if (!html) return 0;
		return text.length / html.length;
	}

	/**
	 * Calculates visual density (text per pixel area)
	 */
	private static getVisualDensity(element: Element): number {
		const rect = element.getBoundingClientRect();
		const area = rect.width * rect.height;
		if (!area) return 0;
		const text = element.textContent || '';
		return text.length / area;
	}

	/**
	 * Calculates link density (ratio of link text to all text)
	 */
	private static getLinkDensity(element: Element): number {
		const text = element.textContent || '';
		const links = Array.from(element.getElementsByTagName('a'));
		let linkText = '';
		for (const link of links) {
			linkText += link.textContent || '';
		}
		if (!text.length) return 0;
		return linkText.length / text.length;
	}

	/**
	 * Scores text based on natural language characteristics
	 */
	private static getNaturalLanguageScore(element: Element): number {
		const text = element.textContent || '';
		if (!text) return 0;

		let score = 0;

		// Look for sentence-like structures
		score += (text.match(/[.!?]+(\s|$)/g) || []).length * 0.5;

		// Look for capital letters starting sentences
		score += (text.match(/[.!?]\s+[A-Z]/g) || []).length * 0.3;

		// Penalize ALL CAPS text
		score -= (text.match(/[A-Z]{4,}/g) || []).length * 0.3;

		// Look for varied punctuation
		score += new Set(text.match(/[,;:'"]/g) || []).size * 0.2;

		return Math.max(0, Math.min(1, score / 10));
	}

	/**
	 * Scores element based on similarity to siblings
	 */
	private static getSiblingSimilarity(element: Element): number {
		const siblings = Array.from(element.parentElement?.children || []);
		if (siblings.length < 2) return 0;

		let similarSiblings = 0;
		const elementClasses = new Set(Array.from(element.classList));
		const elementTags = new Set(Array.from(element.children).map(el => el.tagName));

		for (const sibling of siblings) {
			if (sibling === element) continue;

			// Compare class names
			const siblingClasses = new Set(Array.from(sibling.classList));
			const classIntersection = new Set([...elementClasses].filter(x => siblingClasses.has(x)));
			
			// Compare child element types
			const siblingTags = new Set(Array.from(sibling.children).map(el => el.tagName));
			const tagIntersection = new Set([...elementTags].filter(x => siblingTags.has(x)));

			if (classIntersection.size > 0 || tagIntersection.size > 0) {
				similarSiblings++;
			}
		}

		return similarSiblings / (siblings.length - 1);
	}

	/**
	 * Scores element based on content momentum (similarity to nearby content)
	 */
	private static getContentMomentum(element: Element): number {
		let score = 0;

		// Boost score for positive content indicators
		if (this.POSITIVE_CANDIDATES.test(element.className + ' ' + element.id)) {
			score += 0.25;
		}

		// Reduce score for unlikely content
		if (this.UNLIKELY_CANDIDATES.test(element.className + ' ' + element.id)) {
			score -= 0.25;
		}

		// Boost score if element has paragraphs
		const paragraphs = element.getElementsByTagName('p');
		score += Math.min(1, paragraphs.length * 0.2);

		// Boost score if element has images with captions
		const figures = element.getElementsByTagName('figure');
		score += Math.min(0.5, figures.length * 0.1);

		return Math.max(0, Math.min(1, score));
	}
	/**
	 * Determines if an element is hidden in print view
	 */
	private static isHiddenForPrint(element: Element): boolean {
		const style = window.getComputedStyle(element);
		
		// Check explicit print hiding classes/attributes
		if (element.matches('[class*="hide-for-print"], [class*="no-print"], [class*="noprint"]')) {
			return true;
		}

		// Check print media query styles
		let printStyle: CSSStyleDeclaration | null = null;
		try {
			// Create a print media query
			const mediaQuery = window.matchMedia('print');
			if (mediaQuery.matches) {
				printStyle = style;
			}
		} catch (e) {
			// Fallback if matchMedia isn't supported
			return false;
		}

		if (printStyle) {
			return printStyle.display === 'none' || printStyle.visibility === 'hidden';
		}

		return false;
	}

	/**
	 * Determines if an element is likely UI chrome rather than content
	 */
	private static isUiElement(element: Element): boolean {
		// Check for common UI patterns
		const isButton = element.matches('button, [role="button"], .button, [class*="btn-"]');
		const isIcon = element.matches('[class*="icon"], [class*="emoji"], svg');
		const isToolbar = element.matches('[class*="toolbar"], [class*="controls"], [role="toolbar"]');
		const isWidget = element.matches('[class*="widget"], [class*="follow"], [class*="share"]');

		if (isButton || isIcon || isToolbar || isWidget) {
			return true;
		}

		return false;
	}

	/**
	 * Determines if an element is hidden
	 */
	private static isHidden(element: Element): boolean {
		const style = window.getComputedStyle(element);
		
		// Check various ways elements can be hidden
		return (
			// Display none
			style.display === 'none' ||
			
			// Visibility hidden
			style.visibility === 'hidden' ||
			
			// Opacity 0
			style.opacity === '0' ||
			
			// Zero dimensions
			(style.width === '0px' && style.height === '0px') ||
			
			// Moved off-screen
			(style.position === 'absolute' && (
				style.left === '-9999px' ||
				parseInt(style.left) < -1000 ||
				parseInt(style.right) < -1000 ||
				parseInt(style.top) < -1000 ||
				parseInt(style.bottom) < -1000
			)) ||
			
			// Collapsed
			style.maxHeight === '0px' ||
			
			// Hidden overflow with zero dimensions
			(style.overflow === 'hidden' && 
				(style.height === '0px' || style.width === '0px')) ||
			
			// Explicitly hidden
			element.hasAttribute('hidden') ||
			element.getAttribute('aria-hidden') === 'true'
		);
	}

	/**
	 * Finds the most likely content elements based on calculated metrics
	 */
	private static findContentElements(metrics: ElementMetrics[]): Element[] {
		// Score each element based on its metrics
		const scoredElements = metrics.map(m => ({
			element: m.element,
			score: this.calculateContentScore(m)
		}));

		// Sort by score descending
		scoredElements.sort((a, b) => b.score - a.score);

		// Take the highest scoring elements that form a coherent content block
		const contentElements: Element[] = [];
		let lastScore = 0;

		for (const {element, score} of scoredElements) {
			// Skip if this element is a child of any already selected elements
			const isChildOfSelected = contentElements.some(selectedElement => 
				selectedElement.contains(element)
			);

			// Skip if this element is a parent of any already selected elements
			const isParentOfSelected = contentElements.some(selectedElement => 
				element.contains(selectedElement)
			);

			if (!isChildOfSelected && !isParentOfSelected) {
				if (contentElements.length === 0 || 
					(score > MINIMUM_CONTENT_SCORE && score > lastScore * SCORE_DECAY_FACTOR)) {
					contentElements.push(element);
					lastScore = score;
				}
			}
		}

		// Sort elements by their position in the document
		return contentElements.sort((a, b) => {
			const position = a.compareDocumentPosition(b);
			return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
		});
	}

	/**
	 * Calculates final content score based on metrics
	 * Returns a normalized score between 0 and 1
	 */
	private static calculateContentScore(metrics: ElementMetrics): number {
		const score = (
			metrics.textDensity * SCORING_WEIGHTS.TEXT_DENSITY +
			metrics.visualDensity * SCORING_WEIGHTS.VISUAL_DENSITY +
			(1 - metrics.linkDensity) * SCORING_WEIGHTS.LINK_DENSITY +
			metrics.naturalLanguageScore * SCORING_WEIGHTS.NATURAL_LANGUAGE +
			metrics.siblingSimilarity * SCORING_WEIGHTS.SIBLING_SIMILARITY +
			metrics.contentMomentum * SCORING_WEIGHTS.CONTENT_MOMENTUM
		);

		// Normalize score to 0-1 range
		return score / TOTAL_WEIGHTS;
	}

	/**
	 * Extracts and cleans content from selected elements
	 */
	private static extractContent(elements: Element[]): string {
		// Clone elements to avoid modifying the original DOM
		const contentElements = elements.map(el => el.cloneNode(true) as Element);

		// Clean the content
		for (const element of contentElements) {
			this.cleanElement(element);
		}

		// Combine the content
		return contentElements
			.map(element => element.outerHTML)
			.join('\n');
	}

	/**
	 * Cleans an element of unwanted content
	 */
	private static cleanElement(element: Element): void {
		// First remove obvious unwanted elements
		const unwanted = element.querySelectorAll(
			'script, style, link, meta, ' +
			'[class*="social"], [class*="share"], ' +
			'[class*="comments"], [class*="related"], ' +
			'[class*="widget"], [class*="ad-"], ' +
			'[class*="signup"], [class*="subscribe"], ' +
			'[class*="follow"], [class*="toolbar"], ' +
			'iframe:not([src*="youtube"]):not([src*="vimeo"])'
		);
		
		unwanted.forEach(el => el.remove());

		// Remove hidden elements
		const allElements = element.querySelectorAll('*');
		allElements.forEach(el => {
			if (this.isHidden(el) || this.isHiddenForPrint(el) || this.isUiElement(el)) {
				el.remove();
			}
		});

		// Then check for content boundaries
		const sections = element.querySelectorAll('section, div');
		sections.forEach(section => {
			if (this.isPaywallElement(section) || this.isContentBoundary(section)) {
				section.remove();
			}
		});

		// Remove empty elements
		const empties = element.querySelectorAll('p:empty, div:empty, span:empty');
		empties.forEach(el => el.remove());
	}


	/**
	 * Determines if an element is likely a paywall/membership prompt
	 */
	private static isPaywallElement(element: Element): boolean {
		const text = element.textContent || '';

		// Check for paywall-related text
		if (this.PAYWALL_INDICATORS.test(text)) {
			// Look for authentication-related buttons/links
			const links = Array.from(element.getElementsByTagName('a'));
			const buttons = Array.from(element.getElementsByTagName('button'));
			const authElements = [...links, ...buttons];
			
			const hasAuthButtons = authElements.some(el => 
				this.AUTH_BUTTONS.test(el.textContent || '') ||
				this.AUTH_BUTTONS.test(el.className)
			);

			if (hasAuthButtons) {
				return true;
			}
		}

		// Check for fixed/absolute positioning (common for overlays)
		const style = window.getComputedStyle(element);
		if ((style.position === 'fixed' || style.position === 'absolute') &&
			(style.zIndex !== 'auto' && parseInt(style.zIndex) > 1)) {
			return true;
		}

		return false;
	}

	/**
	 * Finds the article title
	 */
	private static findTitle(doc: Document): string | undefined {
		// Try OpenGraph title
		const ogTitle = doc.querySelector('meta[property="og:title"]');
		if (ogTitle?.getAttribute('content')) {
			return ogTitle.getAttribute('content')!;
		}

		// Try main heading
		const h1 = doc.querySelector('h1');
		if (h1?.textContent) {
			return h1.textContent.trim();
		}

		// Try document title
		if (doc.title) {
			return doc.title.split('|')[0].trim();
		}

		return undefined;
	}

	/**
	 * Generates an excerpt from the content
	 */
	private static generateExcerpt(content: string): string | undefined {
		const div = document.createElement('div');
		div.innerHTML = content;
		
		// Try to find first paragraph
		const firstP = div.querySelector('p');
		if (firstP?.textContent) {
			const text = firstP.textContent.trim();
			return text.length > 160 ? text.slice(0, 157) + '...' : text;
		}

		// Fall back to first text content
		const text = div.textContent?.trim() || '';
		return text.length > 160 ? text.slice(0, 157) + '...' : text || undefined;
	}

	/**
	 * Determines if an element is likely a content boundary (related articles, etc)
	 */
	private static isContentBoundary(element: Element): boolean {
		const text = element.textContent || '';
		const classAndId = (element.className + ' ' + element.id).toLowerCase();

		// Check for common boundary section indicators
		if (this.CONTENT_BOUNDARY_INDICATORS.test(classAndId)) {
			return true;
		}

		// Check for high link density with list structure
		const links = element.getElementsByTagName('a');
		const lists = element.getElementsByTagName('ul');
		if (links.length > 3 && lists.length > 0) {
			const linkDensity = this.getLinkDensity(element);
			if (linkDensity > 0.4) { // Threshold for link-heavy sections
				return true;
			}
		}

		// Check for repeated similar structures (common in related content)
		const children = Array.from(element.children);
		if (children.length > 2) {
			const firstChild = children[0];
			const similarChildren = children.filter(child => 
				child.tagName === firstChild.tagName &&
				Math.abs(child.textContent!.length - firstChild.textContent!.length) < 100
			);
			if (similarChildren.length > children.length * 0.7) { // 70% similar children
				return true;
			}
		}

		return false;
	}
}
