import { VARIANCE_DISCLOSURE } from '../ingestion/apply';

/**
 * How the assumptions work, at a high level, so they can be justified. Every statement describes what the app does; when the app's rules
 * change, change this text with them. Shown on the Assumptions & Diligence tab and in the printable brief.
 */
export const HOW_ASSUMPTIONS_WORK: Array<{ title: string; points: string[] }> = [
  {
    title: 'Where a figure comes from',
    points: [
      'Each figure says whether it came from a document, your own entry, your investor profile or the county record. Your own entry always wins.',
      'Facts only the property can state, such as price, rent and loan terms, are never filled in for you.',
    ],
  },
  {
    title: 'Documents and your standards',
    points: [
      VARIANCE_DISCLOSURE,
      'Your standards are either copied onto a property when it is created, or followed live until the property states its own figure. Each line says which.',
    ],
  },
  {
    title: 'Automated reading',
    points: [
      'Documents are read automatically, which can miss or misread things. You reviewed and confirmed what it found before the project was created, and you are the one underwriting it.',
      "A seller's own claims, such as NOI or cap rate, are shown for comparison and never used.",
    ],
  },
  {
    title: 'County records and original files',
    points: [
      "County figures come from public records. A parcel held by a different owner than the primary parcel is flagged, and building area may overlap between the county's two building lists, so compare it with your offering memorandum.",
      'The original files are kept privately with the property.',
    ],
  },
];
