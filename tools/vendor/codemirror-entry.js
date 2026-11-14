export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, hoverTooltip, tooltips, placeholder, showTooltip } from '@codemirror/view';
export { EditorState, Compartment, Annotation, StateField, StateEffect, Prec } from '@codemirror/state';
export { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, selectLine } from '@codemirror/commands';
export { go } from '@codemirror/lang-go';
export { syntaxHighlighting, HighlightStyle, indentUnit, foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language';
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, startCompletion, completionStatus } from '@codemirror/autocomplete';
export { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
export { linter, lintGutter, setDiagnostics, forceLinting, lintKeymap, nextDiagnostic, openLintPanel } from '@codemirror/lint';
export { tags } from '@lezer/highlight';
