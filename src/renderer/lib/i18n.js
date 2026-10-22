import { useCallback } from 'react';
import { useApp } from './app-context.js';
import { EN_BY_PT } from './i18n-en.js';

// Interface language. Portuguese (Angola) is the default and the source of truth: a missing English text falls back to
// Portuguese, never to a key. Screens are being moved over one by one; those not listed here are still Portuguese only.

export const LANGUAGES = [{ id: 'pt', label: 'Português' }, { id: 'en', label: 'English' }];

const pt = {
  'lang.label': 'Idioma',
  'common.back': 'Voltar', 'common.continue': 'Continuar', 'common.busy': 'Um momento…', 'common.email': 'Email', 'common.password': 'Palavra-passe', 'common.name': 'Nome',

  'steps.welcome': 'Bem-vindo', 'steps.check': 'Verificar o computador', 'steps.data': 'Onde ficam os dados', 'steps.finish': 'Finalizar configurações',
  'steps.mic': 'Microfone', 'steps.signin': 'Entrar', 'steps.ready': 'Pronto',

  'welcome.title': 'Um caderno que ouve.',
  'welcome.body': 'A Ivuenu grava a reunião no teu computador, sem nenhum bot na chamada, e junta o que foi dito às notas que escreves. As reuniões ficam guardadas contigo.',
  'welcome.p1': 'Funciona com Zoom, Meet, Teams, WhatsApp ou uma conversa na mesma sala.',
  'welcome.p2': 'O vermelho só aparece quando está a gravar.',
  'welcome.p3': 'As tuas notas vêm primeiro; o texto escrito pela IA vem depois, sempre identificado.',
  'welcome.start': 'Vamos começar',

  'check.title': 'Verificar o computador',
  'check.body': 'A Ivuenu transcreve aqui, sem enviar o áudio. Vemos se este computador aguenta e dizemos o que esperar.',
  'check.checking': 'A verificar…', 'check.giveMic': 'Dar acesso', 'check.micOk': 'Tudo certo.',

  'data.title': 'Como a Ivuenu trata os teus dados',
  'data.local': 'As reuniões ficam no teu computador', 'data.localHint': 'Transcrições, notas e tarefas são guardadas aqui. Podes guardar uma cópia encriptada na tua conta, se quiseres.',
  'data.cloud': 'A transcrição e a IA correm na nuvem', 'data.cloudHint': 'O áudio é enviado para ser transcrito e apagado logo a seguir. O texto é enviado para escrever notas, resumos e emails. Nada fica guardado no servidor.',
  'data.later': 'Sem bot na chamada: só a tua gravação. Avisa sempre os participantes.',

  'fin.title': 'A finalizar as configurações',
  'fin.body': 'Estamos a deixar tudo pronto neste computador. Demora só um momento.',
  'fin.storage': 'A preparar o armazenamento local', 'fin.prefs': 'A guardar as tuas preferências', 'fin.engine': 'A verificar o serviço de notas',
  'fin.done': 'Tudo configurado.', 'fin.demo': 'Motor de demonstração: a conversa é simulada e as notas só citam essa conversa. O motor de IA local chega numa versão seguinte.',

  'mic.title': 'Microfone', 'mic.default': 'Predefinido do Windows', 'mic.say': 'Diz alguma coisa…', 'mic.level': 'Nível do microfone', 'mic.heard': 'Ouvimos-te bem.',

  'ready.title': 'Tudo pronto.', 'ready.body': 'Podes começar a tua primeira reunião quando quiseres. Lembra-te: avisa sempre os participantes que estão a ser gravados.', 'ready.go': 'Começar',

  'auth.loginTitle': 'Entra na tua conta', 'auth.loginBody': 'As tuas reuniões ficam no teu computador. A conta guarda o teu plano e as definições, e dá acesso à transcrição.',
  'auth.signupTitle': 'Criar conta', 'auth.signupBody': 'Grátis para 10 reuniões por mês. Sem cartão.',
  'auth.login': 'Entrar', 'auth.signup': 'Criar conta', 'auth.forgot': 'Esqueci-me da palavra-passe', 'auth.sso': 'Entrar com a empresa (SSO)', 'auth.soon': 'em breve',
  'auth.noAccount': 'Ainda não tens conta?', 'auth.haveAccount': 'Já tens conta?', 'auth.terms': 'Ao criar conta aceitas os termos e a política de privacidade.',
  'auth.pwShort': 'A palavra-passe precisa de pelo menos 10 caracteres.', 'auth.taken': 'Já existe uma conta com este email.',
  'auth.alreadySigned': 'Já tens sessão iniciada.',
  'forgot.title': 'Recuperar a palavra-passe', 'forgot.body': 'Escreve o email da tua conta. Se existir, enviamos um link que vale 30 minutos.',
  'forgot.sentTitle': 'Verifica o teu email.', 'forgot.sentBody': 'Se esse email tem conta, o link está a caminho. Abre-o, escolhe a nova palavra-passe e volta aqui para entrar. Vê também o spam.',
  'forgot.title2': 'Escreve o código', 'forgot.body2': 'Se esse email tem conta, o código já está a caminho. Pode demorar um minuto. Vê também o spam.',
  'forgot.send': 'Enviar link', 'forgot.code': 'Código do email', 'forgot.newPw': 'Nova palavra-passe', 'forgot.min': 'Mínimo 10 caracteres',
  'forgot.change': 'Mudar palavra-passe', 'forgot.backLogin': 'Voltar a entrar', 'forgot.again': 'Enviar outro link',
  'forgot.doneTitle': 'Palavra-passe mudada.', 'forgot.doneBody': 'Todos os dispositivos ficaram sem sessão. Entra com a nova palavra-passe.',

  'nav.new': 'Nova reunião', 'nav.back': 'Voltar à gravação', 'nav.home': 'Início', 'nav.tasks': 'Tarefas', 'nav.search': 'Pesquisar', 'nav.folders': 'Pastas',
  'nav.newFolder': 'Nova pasta', 'nav.settings': 'Definições', 'nav.local': 'Guardada neste computador.', 'nav.plan': 'Plano', 'nav.plans': 'Planos',
  'nav.profile': 'Perfil e conta', 'nav.logout': 'Terminar sessão', 'nav.recording': 'A gravar', 'nav.paused': 'Em pausa',

  'set.title': 'Definições', 'set.perfil': 'Perfil', 'set.disp': 'Dispositivos', 'set.grav': 'Gravação', 'set.dit': 'Ditado', 'set.cal': 'Calendário',
  'set.rec': 'Receitas', 'set.sync': 'Sincronização', 'set.priv': 'Privacidade', 'set.org': 'Organização', 'set.plano': 'Plano e uso', 'set.appLang': 'Idioma da aplicação', 'set.theme': 'Tema',
};

const en = {
  'lang.label': 'Language',
  'common.back': 'Back', 'common.continue': 'Continue', 'common.busy': 'One moment…', 'common.email': 'Email', 'common.password': 'Password', 'common.name': 'Name',

  'steps.welcome': 'Welcome', 'steps.check': 'Check this computer', 'steps.data': 'Where your data lives', 'steps.finish': 'Finish setup',
  'steps.mic': 'Microphone', 'steps.signin': 'Sign in', 'steps.ready': 'Ready',

  'welcome.title': 'A notebook that listens.',
  'welcome.body': 'Ivuenu records the meeting on your own computer, with no bot in the call, and adds what was said to the notes you write. Your meetings are stored with you.',
  'welcome.p1': 'Works with Zoom, Meet, Teams, WhatsApp or a conversation in the same room.',
  'welcome.p2': 'Red only appears while it is recording.',
  'welcome.p3': 'Your notes come first; text written by the AI comes after, always labelled.',
  'welcome.start': "Let's start",

  'check.title': 'Check this computer',
  'check.body': 'Ivuenu transcribes here, without sending the audio anywhere. We check whether this computer can cope and tell you what to expect.',
  'check.checking': 'Checking…', 'check.giveMic': 'Allow access', 'check.micOk': 'All good.',

  'data.title': 'How Ivuenu treats your data',
  'data.local': 'Your meetings stay on your computer', 'data.localHint': 'Transcripts, notes and tasks are stored here. You can keep an encrypted copy in your account if you want.',
  'data.cloud': 'Transcription and AI run in the cloud', 'data.cloudHint': 'The audio is sent to be transcribed and deleted right after. The text is sent to write notes, summaries and emails. Nothing is kept on the server.',
  'data.later': 'No bot in the call: only your own recording. Always tell the participants.',

  'fin.title': 'Finishing setup',
  'fin.body': "We're getting everything ready on this computer. It only takes a moment.",
  'fin.storage': 'Preparing local storage', 'fin.prefs': 'Saving your preferences', 'fin.engine': 'Checking the notes service',
  'fin.done': 'All set.', 'fin.demo': 'Demonstration engine: the conversation is simulated and notes only quote it. The local AI engine arrives in a later version.',

  'mic.title': 'Microphone', 'mic.default': 'Windows default', 'mic.say': 'Say something…', 'mic.level': 'Microphone level', 'mic.heard': 'We can hear you.',

  'ready.title': "You're all set.", 'ready.body': 'You can start your first meeting whenever you like. Remember: always tell participants they are being recorded.', 'ready.go': 'Start',

  'auth.loginTitle': 'Sign in to your account', 'auth.loginBody': 'Your meetings stay on your computer. The account keeps your plan and settings, and gives access to transcription.',
  'auth.signupTitle': 'Create account', 'auth.signupBody': 'Free for 10 meetings a month. No card.',
  'auth.login': 'Sign in', 'auth.signup': 'Create account', 'auth.forgot': 'Forgot password', 'auth.sso': 'Sign in with your company (SSO)', 'auth.soon': 'coming soon',
  'auth.noAccount': "Don't have an account?", 'auth.haveAccount': 'Already have an account?', 'auth.terms': 'By creating an account you accept the terms and the privacy policy.',
  'auth.pwShort': 'The password needs at least 10 characters.', 'auth.taken': 'An account with this email already exists.',
  'auth.alreadySigned': "You're already signed in.",
  'forgot.title': 'Recover your password', 'forgot.body': 'Enter your account email. If it exists, we send a link that is valid for 30 minutes.',
  'forgot.sentTitle': 'Check your email.', 'forgot.sentBody': 'If that email has an account, the link is on its way. Open it, choose the new password and come back here to sign in. Check spam too.',
  'forgot.title2': 'Enter the code', 'forgot.body2': 'If that email has an account, the code is on its way. It can take a minute. Check spam too.',
  'forgot.send': 'Send link', 'forgot.code': 'Code from the email', 'forgot.newPw': 'New password', 'forgot.min': 'At least 10 characters',
  'forgot.change': 'Change password', 'forgot.backLogin': 'Back to sign in', 'forgot.again': 'Send another link',
  'forgot.doneTitle': 'Password changed.', 'forgot.doneBody': 'Every device was signed out. Sign in with your new password.',

  'nav.new': 'New meeting', 'nav.back': 'Back to recording', 'nav.home': 'Home', 'nav.tasks': 'Tasks', 'nav.search': 'Search', 'nav.folders': 'Folders',
  'nav.newFolder': 'New folder', 'nav.settings': 'Settings', 'nav.local': 'Stored on this computer.', 'nav.plan': 'Plan', 'nav.plans': 'Plans',
  'nav.profile': 'Profile and account', 'nav.logout': 'Sign out', 'nav.recording': 'Recording', 'nav.paused': 'Paused',

  'set.title': 'Settings', 'set.perfil': 'Profile', 'set.disp': 'Devices', 'set.grav': 'Recording', 'set.dit': 'Dictation', 'set.cal': 'Calendar',
  'set.rec': 'Recipes', 'set.sync': 'Sync', 'set.priv': 'Privacy', 'set.org': 'Organisation', 'set.plano': 'Plan and usage', 'set.appLang': 'App language', 'set.theme': 'Theme',
};

const DICT = { pt, en };

export function translate(lang, key, vars) {
  // keyed texts first (nav.home), then Portuguese-as-key texts written straight in the screens, then Portuguese itself
  let text = (DICT[lang] && DICT[lang][key]) || (lang === 'en' && EN_BY_PT[key]) || pt[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  return text;
}

/** const t = useT(); t('nav.home'). Follows the language chosen in the wizard or in Settings. */
export function useT() {
  const { settings } = useApp();
  const lang = (settings && settings.appLanguage) || 'pt';
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

export const missingKeys = (lang) => Object.keys(pt).filter((k) => !(DICT[lang] && k in DICT[lang]));
