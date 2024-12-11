import { debugLog } from './debug';

interface ContentScore {
	score: number;
	element: Element;
}

export class Tidy {
	private static POSITIVE_PATTERNS = /article|content|main|post|body|text|blog|story/i;
	private static NEGATIVE_PATTERNS = /comment|meta|footer|footnote|foot|nav|sidebar|banner|ad|popup|menu/i;
	private static BLOCK_ELEMENTS = ['div', 'section', 'article', 'main'];

	/**
	 * Main entry point - cleans up HTML content and returns the main content
	 */
	static parseFromString(html: string) {
		try {
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');
			return this.parse(doc);
		} catch (error) {
			console.error('Error parsing HTML:', error);
			return null;
		}
	}

	/**
	 * Internal method to process an already parsed document
	 */
	static parse(doc: Document) {
		debugLog('Tidy', 'Starting content extraction');

		// First try to find the main content area
		let mainContent = this.findMainContent(doc);
		
		// If no main content found, use the body
		if (!mainContent) {
			debugLog('Tidy', 'No main content found, using body');
			mainContent = doc.body;
		}

		// Clean up the content
		this.cleanup(mainContent);

		return {
			content: mainContent.outerHTML
		};
	}

	private static findMainContent(doc: Document): Element | null {
		// First look for elements with explicit content markers
		const mainContent = doc.querySelector([
			'main[role="main"]',
			'main',
			'[role="article"]',
			'article',
			'[itemprop="articleBody"]',
			'.post-content',
			'.article-content',
			'#article-content',
			'.content-article',
		].join(','));

		if (mainContent) {
			debugLog('Tidy', 'Found main content via selector');
			return mainContent;
		}

		// Fall back to scoring elements
		const candidates = this.scoreElements(doc);
		if (candidates.length > 0) {
			debugLog('Tidy', `Found ${candidates.length} candidates, selecting highest scoring`);
			return candidates[0].element;
		}

		return null;
	}

	private static scoreElements(doc: Document): ContentScore[] {
		const candidates: ContentScore[] = [];

		this.BLOCK_ELEMENTS.forEach(tag => {
			Array.from(doc.getElementsByTagName(tag)).forEach((element: Element) => {
				const score = this.scoreElement(element);
				if (score > 0) {
					candidates.push({ score, element });
				}
			});
		});

		return candidates.sort((a, b) => b.score - a.score);
	}

	private static scoreElement(element: Element): number {
		let score = 0;

		// Score based on element properties
		const className = element.className.toLowerCase();
		const id = element.id.toLowerCase();

		// Check positive patterns
		if (this.POSITIVE_PATTERNS.test(className) || this.POSITIVE_PATTERNS.test(id)) {
			score += 25;
		}

		// Check negative patterns
		if (this.NEGATIVE_PATTERNS.test(className) || this.NEGATIVE_PATTERNS.test(id)) {
			score -= 25;
		}

		// Score based on content
		const text = element.textContent || '';
		const words = text.split(/\s+/).length;
		score += Math.min(Math.floor(words / 100), 3);

		// Score based on link density
		const links = element.getElementsByTagName('a');
		const linkText = Array.from(links).reduce((acc, link) => acc + (link.textContent?.length || 0), 0);
		const linkDensity = text.length ? linkText / text.length : 0;
		if (linkDensity > 0.5) {
			score -= 10;
		}

		// Score based on presence of meaningful elements
		const paragraphs = element.getElementsByTagName('p').length;
		score += paragraphs;

		const images = element.getElementsByTagName('img').length;
		score += Math.min(images * 3, 9);

		return score;
	}

	private static cleanup(element: Element): void {
		// Remove HTML comments
		const removeComments = (node: Node) => {
			const walker = document.createTreeWalker(
				node,
				NodeFilter.SHOW_COMMENT,
				null
			);

			const comments: Comment[] = [];
			let comment;
			while (comment = walker.nextNode() as Comment) {
				comments.push(comment);
			}

			comments.forEach(comment => comment.remove());
		};

		removeComments(element);

		// First remove elements with unwanted classes/attributes
		const unwantedSelectors = [
			// UI elements
			'[class*="comments"]',
			'[id*="comments"]',
			'[class*="share"]',
			'[class*="social"]',
			'[class*="follow"]',
			'[class*="related"]',
			'[class*="author"]',
			'[class*="byline"]',
			'[class*="profile"]',
			'[class*="avatar"]',
			
			// Interactive elements
			'[class*="clap"]',
			'[class*="vote"]',
			'[class*="bookmark"]',
			'[class*="response"]',
			'[class*="reactions"]',
			'[class*="tooltip"]',
			'[class*="popup"]',
			'[class*="modal"]',
			
			// Ads and promotional
			'.ad',
			'#ad',
			'[class*="advertisement"]',
			'[class*="promotion"]',
			
			// Metadata
			'[class*="time"]',
			'[class*="timestamp"]',
			'[class*="date"]',
			'[class*="read-time"]',
			'[class*="views"]',
			'[class*="stats"]',
			
			// Structural
			'[role="complementary"]',
			'[role="banner"]',
			'[role="navigation"]',
			'speechify-ignore',
			'[rel="author"]',
		];

		element.querySelectorAll(unwantedSelectors.join(',')).forEach(el => el.remove());

		// Define elements to keep
		const keepElements = [
			// Content elements
			'p',
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'article',
			'section',
			'main',
			
			// Lists
			'ul',
			'ol',
			'li',
			
			// Media
			'img',
			'svg',
			'picture',
			'video',
			'audio',
			'iframe',
			
			// Text formatting
			'strong',
			'em',
			'i',
			'b',
			'u',
			'code',
			'pre',
			'blockquote',
			'q',
			
			// Tables
			'table',
			'thead',
			'tbody',
			'tr',
			'th',
			'td',
			
			// Links
			'a',
			
			// Other semantic elements
			'figure',
			'figcaption',
			'mark',
			'cite',
			'sup',
			'sub',
			'span',
			'br',
		];

		// Remove unwanted iframes (keep only video)
		element.querySelectorAll('iframe').forEach(iframe => {
			const src = iframe.getAttribute('src') || '';
			if (!src.includes('youtube.com') && !src.includes('vimeo.com')) {
				iframe.remove();
			}
		});

		// Clean up attributes
		this.cleanAttributes(element);
	}

	private static cleanAttributes(element: Element): void {
		// Keep only essential attributes
		const keepAttributes = [
			// Core attributes
			'title',
			'lang',

			// Media attributes
			'src',
			'srcset',
			'alt',
			'href',

			// Metadata
			'content',
			'property',
			'name',
			'datetime',
			'type',
			'value',

			// Table structure
			'colspan',
			'rowspan',

			// Citations and references
			'rel',
			'cite',
		];
		
		const cleanElement = (el: Element) => {
			// Remove all attributes except those in keepAttributes
			Array.from(el.attributes).forEach(attr => {
				if (!keepAttributes.includes(attr.name)) {
					el.removeAttribute(attr.name);
				}
			});

			// Recursively clean child elements
			Array.from(el.children).forEach(child => cleanElement(child));
		};

		cleanElement(element);
	}
}