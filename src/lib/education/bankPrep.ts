/**
 * The words of the "Prepare for the bank" page: how the relationship with a lender works, what to bring to be successful, the questions a loan
 * officer is likely to ask (with where MathTree already holds the answer), what a lender looks at, and the terms you will hear. General education only. Lenders differ, and nothing
 * here is financial or legal advice. Ranges are described as common, never as rules.
 */

export interface BankPrepPoint { heading: string; text: string }
export interface GlossaryTerm { term: string; plain: string }
export interface BringGroup { heading: string; note: string; items: string[] }
export interface LoanOfficerQuestion { question: string; where: string; tip: string }

export const CONVERSATION: BankPrepPoint[] = [
  {
    heading: 'The loan officer is on your side',
    text: 'Lending is their business, and a good loan officer works to get you to a yes. They also protect the bank, so they look for evidence the loan will be repaid, and they test whether you understand your own numbers.',
  },
  {
    heading: 'Credibility is the test',
    text: 'A borrower who knows where every figure came from, can explain it, and is honest about what is unknown is easier to lend to. One number you cannot explain gives the officer a reason to doubt the rest.',
  },
  {
    heading: 'Underwriting is judgment',
    text: 'Nobody can predict the future, and two careful people can reach different numbers. What counts is assumptions you can defend: each one sourced, reasonable and explained. Knowing your material and defending what you hand the bank is a good starting point.',
  },
  {
    heading: 'Show your work',
    text: 'The brief shows each figure and where it came from. Read it before you go. When the officer points at a number, answer with the figure, where it came from, and why it is reasonable.',
  },
];

/**
 * What a lender typically asks for. Requirements differ by lender, loan and property, so this is a starting list to ask about, not a rule. The
 * third group is what MathTree prepares for you.
 */
export const WHAT_TO_BRING: BringGroup[] = [
  {
    heading: 'About you',
    note: 'The lender is underwriting the borrower as well as the property.',
    items: [
      'A personal financial statement: what you own and what you owe.',
      'Recent tax returns and bank statements, to show income and the cash for the down payment and reserves.',
      'A short summary of your experience with similar properties, or who is helping you.',
      'The entity that will own the property, if there is one, and its documents.',
    ],
  },
  {
    heading: 'About the property',
    note: 'The documents that show what the property earns and what you are buying.',
    items: [
      'The purchase agreement and the offering memorandum.',
      'The rent roll and the leases.',
      'The last twelve months of income and expenses (the T12), and the last two or three years if you can get them.',
      'The property tax and insurance figures.',
    ],
  },
  {
    heading: 'Your underwriting',
    note: 'This is the part MathTree prepares for you.',
    items: [
      'The brief: your figures, each with where it came from, so you can show your work.',
      'The reasons behind your assumptions, written down, so each can be defended.',
      'A downside case: what happens to the loan payment coverage if rents fall or vacancy rises.',
      'The original documents, kept with the property, so you can show where a figure came from.',
    ],
  },
];

/** The numbers a lender usually looks at first, in the order they tend to come up. */
export const LENDER_NUMBERS: GlossaryTerm[] = [
  { term: 'Net operating income (NOI)', plain: 'The income the property keeps after paying to run it, before any loan payment. Everything else a lender looks at starts here.' },
  { term: 'Debt service coverage ratio (DSCR)', plain: 'NOI divided by the year\'s loan payments. 1.00x means the property exactly covers the loan. Lenders want a cushion above that; around 1.25x is a common ask, and it varies by lender and property type.' },
  { term: 'Loan-to-value (LTV)', plain: 'The loan divided by the property\'s value (or price). The lower it is, the more of your own money is at risk first. Lenders set their own limits.' },
  { term: 'Cap rate', plain: 'NOI divided by the price. It is the income a property earns for each dollar paid for it, before financing. A higher rate usually means more income per dollar and often more risk.' },
  { term: 'Debt yield', plain: 'NOI divided by the loan amount. Some lenders use it because, unlike DSCR, it does not depend on the interest rate or the loan\'s length.' },
];

export const GLOSSARY: GlossaryTerm[] = [
  { term: 'Amortization', plain: 'Paying a loan off gradually through regular payments. The amortization period is the length of the schedule the payment is worked out on, which can be longer than the loan\'s term.' },
  { term: 'Assessed value', plain: 'The value the county puts on a property to work out its tax. It is a public record, but it is not the same as market value.' },
  { term: 'Balloon payment', plain: 'The balance still owed when a loan\'s term ends before it is fully paid off. It has to be paid or refinanced then.' },
  { term: 'Cap rate', plain: 'NOI divided by the price. The income earned per dollar paid, before financing.' },
  { term: 'Cash-on-cash return', plain: 'A year\'s cash flow after loan payments, divided by the cash you put in. It measures the yield on your own money.' },
  { term: 'Closing costs', plain: 'The fees paid at purchase, such as lender fees, title, legal and inspections. They add to the cash you need on day one.' },
  { term: 'DSCR', plain: 'Debt service coverage ratio: NOI divided by the year\'s loan payments. See above.' },
  { term: 'Effective gross income', plain: 'The rent the property would collect at full occupancy, plus other income, less what is lost to vacancy and non-payment.' },
  { term: 'Equity', plain: 'What you own: the property\'s value less what is owed on it.' },
  { term: 'Equity multiple', plain: 'The total cash you get back, including the sale, divided by the cash you put in. 2.0x means you get back twice what you invested.' },
  { term: 'Estoppel certificate', plain: 'A tenant\'s signed statement of their lease terms and rent. A lender may ask for these to confirm what the rent roll says.' },
  { term: 'Exit cap rate', plain: 'The cap rate you assume the property sells at. The sale value is the NOI at that time divided by this rate. Using one a little higher than today\'s is a common way to stay conservative.' },
  { term: 'Gross potential rent', plain: 'The rent a property would collect if every unit were rented all year at today\'s rents.' },
  { term: 'Interest-only', plain: 'A period when payments cover interest only and the balance does not go down.' },
  { term: 'IRR (internal rate of return)', plain: 'The yearly rate of return on your cash over the whole hold, counting the sale. It is the growth rate that makes the cash you put in equal the cash you get back, adjusted for when each arrives.' },
  { term: 'Negative leverage', plain: 'When the loan\'s interest rate is higher than the property\'s cap rate, so borrowing earns less than it costs. It is common and it is worth knowing about before the officer raises it.' },
  { term: 'Net present value (NPV)', plain: 'The value today of all the future cash you expect, discounted at your target return, less the cash you put in. Positive means the deal beats your target.' },
  { term: 'Operating expense ratio', plain: 'Operating expenses as a share of the rent. In MathTree it is measured against gross rent before vacancy. Taxes, insurance, repairs and utilities are in it; loan payments and capital reserves are not.' },
  { term: 'Other income', plain: 'Income besides rent, such as pet fees or parking. It counts as income, but lenders look at whether it is steady.' },
  { term: 'Pro forma', plain: 'A projection of what the property is expected to earn. A lender gives more weight to actual results (a T12) than to a seller\'s pro forma.' },
  { term: 'Recourse', plain: 'Whether you are personally liable for the loan beyond the property itself. Ask early whether a loan is recourse or non-recourse.' },
  { term: 'Rent roll', plain: 'The list of every unit or tenant with the rent paid and the lease dates. Lenders compare it with the income a seller reports.' },
  { term: 'Replacement reserve', plain: 'Money set aside each year for big repairs and replacements, such as roofs and appliances. Many lenders require a minimum amount.' },
  { term: 'Sensitivity analysis', plain: 'Re-running the numbers with different assumptions, such as higher vacancy, to see how much the result moves. It shows what the deal can withstand.' },
  { term: 'T12 (trailing twelve months)', plain: 'The property\'s actual income and expenses for the last twelve months. It is the strongest evidence of what the property really earns.' },
  { term: 'Underwriting', plain: 'Working out whether a deal makes sense and what could go wrong: the income, the costs, the loan and the risks. A lender does its own underwriting and compares it with yours.' },
  { term: 'Vacancy and credit loss', plain: 'The share of rent you expect not to collect, because units sit empty or tenants do not pay.' },
];

export const LOAN_OFFICER_QUESTIONS: LoanOfficerQuestion[] = [
  { question: 'How did you arrive at the rent?', where: 'Assumptions & Diligence tab: the Gross rent line, and the Source documents list', tip: 'Say what document or lease it comes from, and whether it is current rent or a projection.' },
  { question: 'Why that vacancy?', where: 'Assumptions & Diligence tab: the Vacancy line and its reason', tip: 'Give the figure and the reason you wrote for it. Mention what the seller\'s document says, and why you used yours if it differs.' },
  { question: 'What are the expenses based on?', where: 'Assumptions & Diligence tab: the Operating expense ratio line, and the document\'s own income and expense table', tip: 'Walk through the seller\'s costs and say what you changed and why. The tie-out check shows whether the table adds up to the seller\'s NOI.' },
  { question: 'Does the property cover the loan?', where: 'Deal page: Overview and the Debt tab (DSCR)', tip: 'State the DSCR, then explain what a lower vacancy or higher rate would do to it.' },
  { question: 'What happens if rents fall or vacancy rises?', where: 'Deal page: the Sensitivity tab', tip: 'Show a downside case and say what you would do, such as reserves or lower leverage.' },
  { question: 'What is your exit?', where: 'Assumptions & Diligence tab: Hold period, Exit cap rate and Selling costs', tip: 'Explain the hold, the exit cap rate and why it is reasonable. A cap rate a little above today\'s reads as careful.' },
  { question: 'How much cash are you putting in?', where: 'The brief: Total Initial Capital Outlay', tip: 'Add the down payment and closing costs, and have the source of the funds ready.' },
  { question: 'What do the county records say about the property?', where: 'Deal page: the Property tab, and the County parcel line in Assumptions', tip: 'Give the owner of record, the assessed value and acreage, and note any difference from the offering memorandum.' },
];

/** Shown at the foot of the page. */
export const BANK_PREP_NOTE = 'This is general education to help you prepare. It is not financial or legal advice, and lenders differ in what they require. Ask your lender what they need, and talk to a professional about your own situation.';
