
export interface Contact {
  id: string;
  name: string;
  relation: string;
  subject: string;
  phone: string;
  status: 'pending' | 'called' | 'skipped';
}

export enum AppSection {
  DIALER = 'dialer',
  SETTINGS = 'settings'
}
