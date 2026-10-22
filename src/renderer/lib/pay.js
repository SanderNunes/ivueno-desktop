// Small helpers shared by the payment screens.

/** 12 000,00 Kz (what the checkout shows) */
export const money = (amount) => `${Number(amount).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
/** 12 000 Kz (plan cards and banners) */
export const kz = (amount) => `${Number(amount).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} Kz`;
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-PT') : '');

export const PITCH = {
  free: 'Para experimentar: 120 minutos de transcrição por mês.',
  pro: 'Reuniões sem limite, todas as ajudas, receitas tuas.',
  pro_cloud: 'Transcrição na nuvem para computadores sem placa gráfica.',
  team: 'Pastas partilhadas, consola de administração, registo de auditoria.',
  enterprise: 'Faturado. Acrescenta início de sessão da empresa e acordo de suporte.',
};
