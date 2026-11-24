/**
 * The application kit: what a New York landlord usually asks for, the income rule they apply, a one-page renter
 * profile, and a ready-written inquiry for an apartment. It is kept on the device only.
 */
import type { ListingData } from './domain.ts';
import { bedroomLabel, formatRent } from './search.ts';

export type RenterProfile = {
  name: string;
  phone: string;
  email: string;
  employer: string;
  jobTitle: string;
  annualIncome: string;
  moveIn: string;
  people: string;
  pets: string;
  creditScore: string;
  guarantor: string;
  about: string;
};
export const PROFILE_FIELDS: [keyof RenterProfile, string, string][] = [
  ['name', 'Full name', 'Alex Rivera'],
  ['email', 'Email', 'alex@example.com'],
  ['phone', 'Phone', '(212) 555-0100'],
  ['employer', 'Employer', 'Company name'],
  ['jobTitle', 'Job title', 'Product designer'],
  ['annualIncome', 'Annual income before tax', '120000'],
  ['moveIn', 'Move-in date', 'March 1'],
  ['people', 'People moving in', '2 adults'],
  ['pets', 'Pets', 'None'],
  ['creditScore', 'Credit score', '740'],
  ['guarantor', 'Guarantor', 'None, or a guarantor company'],
  ['about', 'A line about you', 'Quiet, non-smoking, long-term renter'],
];
export const emptyProfile = (): RenterProfile => Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, ''])) as RenterProfile;

export const DOCUMENTS = [
  'Photo ID (driver’s license or passport)',
  'Two most recent pay stubs',
  'Employment letter with salary and start date',
  'Two most recent bank statements',
  'Last year’s tax return or W-2',
  'Reference from your current landlord',
  'Guarantor’s documents, if you use one',
];

/** Landlords usually want a yearly income of 40 times the rent, and a guarantor's of 80 times. */
export const INCOME_MULTIPLE = 40;
export const GUARANTOR_MULTIPLE = 80;

const dollars = (text: string) => {
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
};

/** The highest rent an income qualifies for, and whether it qualifies for a given rent. */
export function incomeCheck(annualIncome: string, rent?: number) {
  const income = dollars(annualIncome);
  if (income === null) return null;
  const maxRent = Math.floor(income / INCOME_MULTIPLE);
  return {
    maxRent,
    ...(rent
      ? { qualifies: income >= rent * INCOME_MULTIPLE, needed: rent * INCOME_MULTIPLE, guarantorNeeds: rent * GUARANTOR_MULTIPLE }
      : {}),
  };
}

/** The renter profile as plain text, to paste into an email or an application. */
export function profileText(profile: RenterProfile) {
  const income = dollars(profile.annualIncome);
  const lines = [
    profile.name && `${profile.name}`,
    [profile.email, profile.phone].filter(Boolean).join(' · '),
    profile.employer && `Works at ${profile.employer}${profile.jobTitle ? ' as ' + profile.jobTitle : ''}`,
    income && `Annual income: ${formatRent(income)}`,
    profile.creditScore && `Credit score: ${profile.creditScore}`,
    profile.moveIn && `Move-in: ${profile.moveIn}`,
    profile.people && `Moving in: ${profile.people}`,
    profile.pets && `Pets: ${profile.pets}`,
    profile.guarantor && `Guarantor: ${profile.guarantor}`,
    profile.about,
  ];
  return lines.filter(Boolean).join('\n');
}

/** A short first message to the landlord or broker about one apartment. */
export function inquiryText(profile: RenterProfile, listing: Pick<ListingData, 'address' | 'unit' | 'rent' | 'bedrooms'>) {
  const place = listing.unit ? `${listing.address}, Unit ${listing.unit}` : listing.address;
  const name = profile.name || 'Hello';
  return [
    `Hi,`,
    ``,
    `I'm interested in ${place} (${bedroomLabel(listing.bedrooms).toLowerCase()}, ${formatRent(listing.rent)} a month). Is it still available, and when could I see it?`,
    ``,
    profileText(profile),
    ``,
    `I have my documents ready to apply.`,
    ``,
    `Thank you,`,
    name === 'Hello' ? '' : name,
  ]
    .join('\n')
    .trim();
}
