// =====================================================================
// LANGUAGE DETECTION — mapping file extension → Monaco language id
// =====================================================================

export const EXT_LANG_MAP = {
  'c':'c','h':'c',
  'cpp':'cpp','cc':'cpp','cxx':'cpp','c++':'cpp','hpp':'cpp','hh':'cpp','hxx':'cpp',
  'cs':'csharp',
  'java':'java','kt':'kotlin','kts':'kotlin','scala':'scala','groovy':'groovy',
  'py':'python','pyw':'python',
  'rb':'ruby','php':'php','lua':'lua','pl':'perl','r':'r',
  'js':'javascript','mjs':'javascript','cjs':'javascript',
  'ts':'typescript','mts':'typescript',
  'jsx':'javascript','tsx':'typescript',
  'html':'html','htm':'html','css':'css','scss':'scss','less':'less','vue':'html',
  'rs':'rust','go':'go','swift':'swift',
  'sh':'shell','bash':'shell','zsh':'shell','fish':'shell',
  'ps1':'powershell','bat':'bat','cmd':'bat',
  'json':'json','jsonc':'json','yaml':'yaml','yml':'yaml',
  'toml':'ini','ini':'ini','cfg':'ini','conf':'ini',
  'xml':'xml','svg':'xml','xaml':'xml','sql':'sql','env':'ini',
  'md':'markdown','mdx':'markdown','tex':'latex','rst':'restructuredtext',
  'mmd':'mermaid','puml':'plaintext',
  'txt':'plaintext','log':'plaintext','diff':'diff','patch':'diff',
  'dockerfile':'dockerfile','makefile':'makefile',
};

export const ALL_LANGUAGES = [
  {value:'plaintext',label:'Plain Text'},{value:'c',label:'C'},{value:'cpp',label:'C++'},
  {value:'csharp',label:'C#'},{value:'python',label:'Python'},{value:'javascript',label:'JavaScript'},
  {value:'typescript',label:'TypeScript'},{value:'java',label:'Java'},{value:'kotlin',label:'Kotlin'},
  {value:'rust',label:'Rust'},{value:'go',label:'Go'},{value:'swift',label:'Swift'},
  {value:'php',label:'PHP'},{value:'ruby',label:'Ruby'},{value:'lua',label:'Lua'},
  {value:'shell',label:'Shell/Bash'},{value:'powershell',label:'PowerShell'},{value:'bat',label:'Batch'},
  {value:'html',label:'HTML'},{value:'css',label:'CSS'},{value:'scss',label:'SCSS'},
  {value:'less',label:'Less'},{value:'json',label:'JSON'},{value:'yaml',label:'YAML'},
  {value:'xml',label:'XML'},{value:'sql',label:'SQL'},{value:'markdown',label:'Markdown'},
  {value:'mermaid',label:'Mermaid'},{value:'ini',label:'INI / TOML'},{value:'dockerfile',label:'Dockerfile'},
  {value:'makefile',label:'Makefile'},{value:'diff',label:'Diff / Patch'},{value:'latex',label:'LaTeX'},
  {value:'r',label:'R'},{value:'scala',label:'Scala'},
];

/**
 * Tự động detect Monaco language id từ tên file.
 * @param {string|null} filename
 * @returns {string} Monaco language id
 */
export function detectLanguage(filename) {
  if (!filename) return 'plaintext';
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile')                        return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'ini';
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return 'plaintext';
  return EXT_LANG_MAP[lower.slice(dotIdx + 1)] || 'plaintext';
}
