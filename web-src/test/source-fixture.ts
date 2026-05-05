type SourceFixture = {
	raw: string;
	includes: (snippet: string) => boolean;
};

function normalizeCodeSegment(segment: string): string {
	return segment
		.replace(/,([)\]}])/g, "$1")
		.replace(/\(([$A-Z_a-z][$\w]*)\)\s*=>/g, "$1=>")
		.replace(/\b([$A-Z_a-z][$\w]*)\s*=>/g, "$1=>");
}

function normalizeSourceText(text: string): string {
	const source = text.replace(/\r\n?/g, "\n");
	let output = "";
	let codeSegment = "";
	let quote: "'" | '"' | "`" | null = null;
	const flushCodeSegment = () => {
		output += normalizeCodeSegment(codeSegment);
		codeSegment = "";
	};
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		if (quote) {
			if (char === "\\") {
				output += char;
				if (index + 1 < source.length) output += source[++index];
				continue;
			}
			if (char === quote) {
				output += quote === "`" ? "`" : "'";
				quote = null;
				continue;
			}
			output += char;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			flushCodeSegment();
			quote = char;
			output += char === "`" ? "`" : "'";
			continue;
		}
		if (/\s/.test(char)) {
			if (
				(output || codeSegment) &&
				!output.endsWith(" ") &&
				!codeSegment.endsWith(" ")
			) {
				codeSegment += " ";
			}
			continue;
		}
		if ("{}()[],;:?.".includes(char)) {
			codeSegment = codeSegment.trimEnd() + char;
			while (/\s/.test(source[index + 1] || "")) index++;
			continue;
		}
		codeSegment += char;
	}
	flushCodeSegment();
	return output.trim();
}

export function sourceFixture(text: string): SourceFixture {
	const normalized = normalizeSourceText(text);
	return {
		raw: text,
		includes(snippet: string): boolean {
			return (
				text.includes(snippet) ||
				normalized.includes(normalizeSourceText(snippet))
			);
		},
	};
}
