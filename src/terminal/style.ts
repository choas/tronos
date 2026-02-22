// ANSI escape codes for text styling
const styles = {
  // Reset all styles
  reset: '\x1b[0m',

  // Text styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  hidden: '\x1b[8m',
  strikethrough: '\x1b[9m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Bright foreground colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',

  // Bright background colors
  bgBrightBlack: '\x1b[100m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
  bgBrightMagenta: '\x1b[105m',
  bgBrightCyan: '\x1b[106m',
  bgBrightWhite: '\x1b[107m',
};



const style = {
  bold: (str: string) => `${styles.bold}${str}${styles.reset}`,
  dim: (str: string) => `${styles.dim}${str}${styles.reset}`,
  italic: (str: string) => `${styles.italic}${str}${styles.reset}`,
  underline: (str: string) => `${styles.underline}${str}${styles.reset}`,
  inverse: (str: string) => `${styles.inverse}${str}${styles.reset}`,
  hidden: (str: string) => `${styles.hidden}${str}${styles.reset}`,
  strikethrough: (str: string) => `${styles.strikethrough}${str}${styles.reset}`,

  black: (str: string) => `${styles.black}${str}${styles.reset}`,
  red: (str: string) => `${styles.red}${str}${styles.reset}`,
  green: (str: string) => `${styles.green}${str}${styles.reset}`,
  yellow: (str: string) => `${styles.yellow}${str}${styles.reset}`,
  blue: (str: string) => `${styles.blue}${str}${styles.reset}`,
  magenta: (str: string) => `${styles.magenta}${str}${styles.reset}`,
  cyan: (str: string) => `${styles.cyan}${str}${styles.reset}`,
  white: (str: string) => `${styles.white}${str}${styles.reset}`,
  
  brightBlack: (str: string) => `${styles.brightBlack}${str}${styles.reset}`,
  brightRed: (str: string) => `${styles.brightRed}${str}${styles.reset}`,
  brightGreen: (str: string) => `${styles.brightGreen}${str}${styles.reset}`,
  brightYellow: (str: string) => `${styles.brightYellow}${str}${styles.reset}`,
  brightBlue: (str: string) => `${styles.brightBlue}${str}${styles.reset}`,
  brightMagenta: (str: string) => `${styles.brightMagenta}${str}${styles.reset}`,
  brightCyan: (str: string) => `${styles.brightCyan}${str}${styles.reset}`,
  brightWhite: (str: string) => `${styles.brightWhite}${str}${styles.reset}`,

  bgBlack: (str: string) => `${styles.bgBlack}${str}${styles.reset}`,
  bgRed: (str: string) => `${styles.bgRed}${str}${styles.reset}`,
  bgGreen: (str: string) => `${styles.bgGreen}${str}${styles.reset}`,
  bgYellow: (str: string) => `${styles.bgYellow}${str}${styles.reset}`,
  bgBlue: (str: string) => `${styles.bgBlue}${str}${styles.reset}`,
  bgMagenta: (str: string) => `${styles.bgMagenta}${str}${styles.reset}`,
  bgCyan: (str: string) => `${styles.bgCyan}${str}${styles.reset}`,
  bgWhite: (str: string) => `${styles.bgWhite}${str}${styles.reset}`,
  
  bgBrightBlack: (str: string) => `${styles.bgBrightBlack}${str}${styles.reset}`,
  bgBrightRed: (str: string) => `${styles.bgBrightRed}${str}${styles.reset}`,
  bgBrightGreen: (str: string) => `${styles.bgBrightGreen}${str}${styles.reset}`,
  bgBrightYellow: (str: string) => `${styles.bgBrightYellow}${str}${styles.reset}`,
  bgBrightBlue: (str: string) => `${styles.bgBrightBlue}${str}${styles.reset}`,
  bgBrightMagenta: (str: string) => `${styles.bgBrightMagenta}${str}${styles.reset}`,
  bgBrightCyan: (str: string) => `${styles.bgBrightCyan}${str}${styles.reset}`,
  bgBrightWhite: (str: string) => `${styles.bgBrightWhite}${str}${styles.reset}`,
  
  rgb: (r: number, g: number, b: number) => (str: string) => `\x1b[38;2;${r};${g};${b}m${str}\x1b[0m`,
  bgRgb: (r: number, g: number, b: number) => (str: string) => `\x1b[48;2;${r};${g};${b}m${str}\x1b[0m`,
  
  color256: (code: number) => (str: string) => `\x1b[38;5;${code}m${str}\x1b[0m`,
  bgColor256: (code: number) => (str: string) => `\x1b[48;5;${code}m${str}\x1b[0m`,
};

export default style;
