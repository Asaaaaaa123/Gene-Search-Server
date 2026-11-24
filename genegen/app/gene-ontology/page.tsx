import { redirect } from 'next/navigation';

// Thematic GO has one analysis: the customizable themes. The default-theme version was removed, so there is no
// choice of approach left to show; every link to /gene-ontology opens the analysis itself.
export default function GeneOntology() {
  redirect('/gene-ontology/customize-theme');
}
