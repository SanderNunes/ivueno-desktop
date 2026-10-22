import { createContext, useContext } from 'react';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const PLAN_NAMES = {
  free: 'Gratuito', pro: 'Pro', pro_cloud: 'Pro + Nuvem', team: 'Equipa', enterprise: 'Empresa',
};

export const TEMPLATE_NAMES = {
  auto: 'Escolhe por mim', sales: 'Chamada de vendas', general: 'Geral', one_to_one: 'Um para um',
  standup: 'Stand-up', interview: 'Entrevista', brainstorm: 'Brainstorm', minutes: 'Ata de reunião',
};
