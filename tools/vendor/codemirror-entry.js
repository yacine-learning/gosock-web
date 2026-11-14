export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, hoverTooltip, tooltips, placeholder } from '@codemirror/view';
export { EditorState, Compartment, Annotation } from '@codemirror/state';
export { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, selectLine } from '@codemirror/commands';
export { go } from '@codemirror/lang-go';
export { syntaxHighlighting, HighlightStyle, indentUnit, foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxTree } from '@codemirror/language';
export { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion, startCompletion } from '@codemirror/autocomplete';
export { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
export { linter, lintGutter, setDiagnostics, forceLinting, lintKeymap } from '@codemirror/lint';
export { tags } from '@lezer/highlight';
