import { ls, cd, pwd, cat, echo, mkdir, touch, rm, cp, mv, head, tail, grep, wc } from './filesystem';
import { clear, history, version } from './system';
import { whoami, env, exportCmd, unset } from './environment';
import { alias, unalias } from './alias';
import { which, type } from './which';
import { help } from './help';
import { man } from './man';
import { source, dot } from './source';
import { session } from './session';
import { config } from './config';
import { ai } from './ai';
import { curl, fetchCmd } from './network';
import { theme } from './theme';
import { reset, factoryReset } from './reset';
import { boot } from './boot';
import { tpkg } from './tpkg';
import { feedback } from './feedback';
import { timewarp } from './timewarp';
import { cron } from './cron';
import { update } from './update';
import { exit } from './exit';

export { ls, cd, pwd, cat, echo, mkdir, touch, rm, cp, mv, head, tail, grep, wc, clear, history, version, whoami, env, exportCmd, unset, alias, unalias, which, type, help, man, source, dot, session, config, ai, curl, fetchCmd, theme, reset, factoryReset, boot, tpkg, feedback, timewarp, cron, update, exit };

export const BUILTIN_COMMANDS = {
  ls,
  cd,
  pwd,
  cat,
  echo,
  mkdir,
  touch,
  rm,
  cp,
  mv,
  head,
  tail,
  grep,
  wc,
  clear,
  history,
  version,
  whoami,
  env,
  export: exportCmd,
  unset,
  alias,
  unalias,
  which,
  type,
  help,
  man,
  source,
  '.': dot,
  session,
  config,
  '@ai': ai,
  curl,
  fetch: fetchCmd,
  theme,
  reset,
  'factory-reset': factoryReset,
  boot,
  tpkg,
  feedback,
  timewarp,
  cron,
  update,
  exit,
  quit: exit,
} as const;