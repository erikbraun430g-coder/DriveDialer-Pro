
export interface Contact {
  id: string;
  name: string;
  relation: string;
  subject: string;
  phone: string;
  status: 'pending' | 'called';
}

export enum AppSection {
  DIALER = 'dialer',
  SETTINGS = 'settings'
}
