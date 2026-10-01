import type { Metadata } from 'next';
import { IvccaWorkspace } from '@/components/ivcca/Workspace';

export const metadata: Metadata = {
  title: 'IVCCA',
  description: 'Inter-Variability Cross-Correlation Analysis workspace',
};

export default function IvccaPage() {
  return <IvccaWorkspace />;
}
