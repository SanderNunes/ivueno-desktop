/**
 * Names and terms the speakers are likely to use, sent to the speech service so it spells them right (it hears "kwanzas" as "quântures" without a hint).
 * The people of the meeting come first (they matter most), then a short glossary of local terms. The service reads at most a few hundred characters.
 */
const GLOSSARY = 'kwanzas, Multicaixa Express, Unitel, Africell, Luanda';
const MAX = 380;

function vocabularyPrompt(meeting) {
  const people = ((meeting && meeting.attendees) || []).map((a) => String(a.name || '').trim()).filter(Boolean).join(', ');
  return [people, GLOSSARY].filter(Boolean).join(', ').slice(0, MAX);
}

module.exports = { vocabularyPrompt, GLOSSARY };
