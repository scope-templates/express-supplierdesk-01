export const CALL_OPENERS = [
  "Called {contact}, {title}, for the yearly check-in.",
  "{contact} ({title}) called back after two tries.",
  "Scheduled call with {contact}, {title}; ran about half an hour.",
  "Quick call with {contact}, {title}.",
  "{contact}, {title}, walked us through the operation.",
  "Video call with {contact}, {title}, and two people from their floor.",
  "Reached {contact} ({title}) on the second try.",
  "Call with {contact}, {title}, set up through their sales office.",
  "Follow-up call with {contact}, {title}.",
  "Spent twenty minutes with {contact}, {title}.",
  "Long call with {contact}, {title}; covered most of our questionnaire.",
];

export const REQUEST_CALL_OPENERS = [
  "Called {contact}, {title}, on a client question.",
  "Called {contact}, {title}, to answer a client request.",
  "{contact}, {title}, returned our call about a client question.",
  "Reached {contact} ({title}) for a client check.",
];

export const STATE_LINES: Record<string, string[]> = {
  plants_many: [
    "They run {count} {plants}: {list}.",
    "{count} {plants} in operation: {list}.",
    "{first} listed the {plants} as {list}.",
  ],
  plants_one: [
    "Everything runs out of the {town} {plant}.",
    "One {plant}, in {town}.",
    "{first} confirmed a single {plant}, in {town}.",
  ],
  headcount: [
    "Headcount is about {n}.",
    "{first} put headcount at roughly {n}.",
    "About {n} people across all sites.",
    "They employ around {n}.",
  ],
  chief_executive: [
    "{ceo} runs the company.",
    "Chief executive is {ceo}.",
    "{first} reports up to {ceo}, the chief executive.",
    "{ceo} is the chief executive.",
  ],
  ownership_family: ["Family owned, with the {gen} generation in charge.", "Family owned; no outside investors.", "The family still owns all of it."],
  ownership_founder: ["Founder owned.", "The founder owns it outright.", "Owned by the founder, no investors."],
  ownership_esop: ["Employee owned through an ESOP since {year}.", "It is an ESOP company, employee owned since {year}."],
  ownership_pe: ["Owned by {holder}.", "{holder} is the majority owner.", "Private equity owned: {holder}."],
  ownership_subsidiary: ["Part of {holder}.", "Wholly owned by {holder}.", "A division of {holder}."],
  ownership_lenders: ["The lenders own it after the Chapter 11 case.", "Owned by its former lenders since the bankruptcy."],
  headquarters: ["Head office is in {hq}.", "Offices are in {hq}.", "Corporate office sits in {hq}."],
  certifications_some: ["They hold {certs}.", "Certificates on hand: {certs}.", "{first} confirmed {certs}."],
  certifications_none: ["They could not show us any third-party certificates.", "No third-party certificates."],
};

export const CHANGE_LINES = [
  "{first} said they {phrase} in {month}.",
  "Worth knowing: they {phrase} in {month}.",
  "{first} mentioned they {phrase} in {month}.",
  "They {phrase} in {month}, per {first}.",
  "Big news on their end: they {phrase} in {month}.",
  "{first} brought up that they {phrase} in {month}.",
];

export const CHANGE_PHRASES: Record<string, string> = {
  acquired_pe: "were bought by {holder}",
  acquired_strategic: "were acquired by {holder}",
  parent_changed: "were sold by {old} to {holder}",
  plant_opened: "opened a {plant} in {town}",
  plant_closed: "closed the {town} {plant}",
  hq_moved: "moved the head office from {old} to {hq}",
  ceo_replaced: "replaced {old} with {ceo} as chief executive",
  cert_gained: "earned {cert}",
  cert_lapsed: "let {cert} lapse",
  headcount_cut: "cut about {n} jobs",
  ch11_filed: "filed for Chapter 11",
  ch11_emerged: "came out of Chapter 11",
};

export const RECENT_CHANGE_VALUES: Record<string, string> = {
  acquired_pe: "Bought by {holder}, {month}",
  acquired_strategic: "Acquired by {holder}, {month}",
  parent_changed: "{old} sold it to {holder}, {month}",
  plant_opened: "Opened a {plant} in {town}, {month}",
  plant_closed: "Closed the {town} {plant}, {month}",
  hq_moved: "Head office moved from {old} to {hq}, {month}",
  ceo_replaced: "{ceo} replaced {old} as chief executive, {month}",
  cert_gained: "Earned {cert}, {month}",
  cert_lapsed: "{cert} lapsed, {month}",
  headcount_cut: "Cut about {n} jobs, {month}",
  ch11_filed: "Filed Chapter 11, {month}",
  ch11_emerged: "Emerged from Chapter 11, {month}",
};

export const OPS_LINES = [
  "Lead times are running {weeks} weeks on standard orders.",
  "Quoted lead time is {weeks} weeks, up from {fewer} last year.",
  "On-time delivery was {pct}% last quarter by their count.",
  "A price increase of {pct2}% is on the table for January.",
  "Capacity is tight; they put utilization near {pct}%.",
  "No quality escapes reported since spring.",
  "They switched ERP systems this year and invoices ran late for a month.",
  "Material costs are up and they are passing part of it through.",
  "They have one qualified backup supplier for their main input.",
  "Second shift is staffed again after a slow winter.",
  "Asked about insurance; certificate of insurance on request.",
  "They want annual volume commitments before holding price.",
  "Customer list is mostly in the Midwest, nothing over {pct2}% of sales.",
  "Their quality manager has been there {years} years.",
  "Inventory buffer for our clients is about {weeks2} weeks of demand.",
  "They run a quarterly scorecard with their larger accounts.",
  "Payment terms are net 30; they offered 1% ten for early pay.",
  "Union contract runs through {year}.",
];

export const FREIGHT_LINES = [
  "Fleet is about {trucks} tractors, mostly owned.",
  "Driver turnover is the main headache this year.",
  "Claims ratio is under one percent by their numbers.",
  "They cover {states} states with their own trucks and broker the rest.",
  "Safety rating is satisfactory; last audit was quiet.",
  "Fuel surcharge follows the weekly diesel index.",
];

export const CALL_CLOSERS = [
  "Next check-in planned for {next}.",
  "Sent them our standard questionnaire afterward.",
  "Nothing else of note.",
  "They will email their certificate list.",
  "Asked for a plant tour in {next}.",
  "",
  "",
];

export const FACT_NOTES: Record<string, string[]> = {
  ownership: ["state filing", "their site, about page", "owner's letter to customers", "trade show booth chat", "their sales rep, by email"],
  parent_company: ["state filing", "their site, about page", "annual report of the parent", "their controller, by email"],
  headquarters: ["state filing", "invoice letterhead", "their site, contact page", "W-9 they sent"],
  plants: ["their site, locations page", "plant list they emailed", "trade show booth chat", "their sales rep, by email"],
  headcount: ["their site, careers page", "HR manager, by email", "trade show booth chat", "their sales rep, by phone"],
  chief_executive: ["their site, leadership page", "state filing", "trade association directory", "org chart they sent"],
  certifications: ["certificate copy they sent", "registrar's certificate PDF", "quality manager, by email", "audit summary they shared"],
  recent_change: ["trade show booth chat", "their sales rep, by phone", "local business journal", "customer letter they sent"],
};

export const DATED_FACT_NOTES: Record<string, string[]> = {
  ownership: ["press release, {month}", "deal announcement, {month}"],
  parent_company: ["press release, {month}", "deal announcement, {month}"],
  plants: ["plant tour, {month}", "press release, {month}"],
  headcount: ["state WARN notice, {month}", "press release, {month}"],
  chief_executive: ["press release, {month}", "customer letter, {month}"],
  headquarters: ["change-of-address letter, {month}", "press release, {month}"],
  certifications: ["registrar's notice, {month}", "certificate copy they sent, {month}"],
  recent_change: ["press release, {month}", "court filing, {month}", "local business journal, {month}"],
};

export const QUESTIONS: Record<string, string[]> = {
  ownership: [
    "We are about to sign a two-year supply agreement. Who owns {name}, and has that changed since we onboarded them?",
    "Legal wants the ownership chain before renewal. Can you confirm who owns {name}?",
    "Is {name} independent or part of a bigger group?",
  ],
  parent_company: [
    "Who is the parent company? Our contract names a guarantor.",
    "Need the parent company for our credit review on {name}.",
  ],
  plants: [
    "Which plants make our {part}? Our quality team wants the address on file.",
    "Do they still run the {town} {plant}? We were told our orders ship from there.",
    "How many {plants} do they run, and where?",
  ],
  certifications: [
    "Audit coming up in {month}. Can you confirm their {cert}?",
    "What certifications do they hold? Our customer is asking for a list.",
    "Is their {cert} certificate valid? We need it for the supplier file our auditor reviews.",
  ],
  chief_executive: [
    "Heard about a leadership change. Who runs the company?",
    "Who is the chief executive? Our VP wants to set up a call.",
  ],
  headcount: [
    "Service has slipped this quarter. Have they cut staff?",
    "Roughly how many people work there? Trying to size the risk if they lose a few key people.",
  ],
  headquarters: [
    "We need their legal address for the contract. Where is the head office?",
    "Did they move their head office? An invoice came from a new address.",
  ],
  recent_change: [
    "Anything new with them this year we should know before our quarterly review?",
    "A competitor told us they are in financial trouble. Anything on a Chapter 11 filing?",
    "Quick sanity check before we raise volume with {name}: any big changes on their side?",
  ],
};

export const ANSWER_CALL = [
  "Answer to your {asked} request: spoke with {contact}, {title}, on {date}. {state} {change}",
  "Called {contact} ({title}) on {date}. {state} {change}",
  "From our call with {contact}, {title}, on {date}: {state} {change}",
];

export const ANSWER_CHECK = [
  "Checked on {date} ({doc}). {state}",
  "We checked this on {date}; {doc}. {state}",
  "Answer: {state} Checked {date}; {doc}.",
];

export const ANSWER_FILE = [
  "From the supplier file: {label} is \"{value}\", checked {checked} by {checker}.",
  "Our fact row on {label} reads \"{value}\" (checked {checked}, {checker}).",
  "The supplier file has {label} as \"{value}\", checked by {checker} on {checked}.",
];

export const CLIENT_OPS_NOTES = [
  "Lead time on {part} slipped to {weeks} weeks.",
  "Second late shipment this quarter on the {part} order.",
  "Their quote for next year is up {pct2}%. Pushing back.",
  "Sample lot of {part} passed incoming inspection.",
  "Rejected {n} cases of {part} at receiving; credit issued.",
  "Rep visited our plant and wants to bid on more of our {part} work.",
  "Payment terms moved to net 45 at our request.",
  "Asked for a second supplier on {part} before we raise volume.",
  "Good month; every {part} delivery on time.",
  "Moved the {part} order to them from our old vendor.",
  "Their invoice address changed; AP updated the vendor record.",
  "Price held for another six months on {part}.",
  "Short-shipped {n} units of {part}; balance came the next week.",
  "Their customer service is slow to answer email. Calling works better.",
  "Corrective action on the {part} defect is closed.",
  "Met their account manager at our plant. Wants a forecast for {quarter}.",
];

export const FREIGHT_CLIENT_NOTES = [
  "Missed the pickup window twice this month.",
  "Freight damage on {n} pallets; they paid the claim.",
  "Rates held for {quarter}.",
  "Driver showed up without the right paperwork again.",
  "Good on-time record this quarter.",
];

export const STATUS_NOTES: Record<string, string[]> = {
  onboarding: [
    "Started onboarding; W-9 and insurance certificate received.",
    "Sent our supplier questionnaire. Waiting on samples.",
    "Onboarding paperwork in. Quality wants a first article before approval.",
  ],
  approved: [
    "First article passed. Moved to approved.",
    "Supplier audit done; approved for {part}.",
    "Approved after the trial order came in clean.",
  ],
  on_hold: [
    "Putting them on hold until the quality problem on {part} is closed.",
    "On hold while we sort out pricing for next year.",
    "Holding new orders until they answer our corrective action request.",
  ],
  dropped: [
    "Dropping them; the {part} volume moved elsewhere.",
    "We are done with them after the third late order.",
    "Dropped. Could not get pricing anywhere near the other quotes.",
  ],
};

export const CLIENT_HEARD_NOTES = [
  "Their rep told us they {phrase} in {month}.",
  "Heard from their sales guy that they {phrase} in {month}.",
  "Picked up at the trade show: they {phrase} in {month}.",
  "Our buyer heard on a call that they {phrase} in {month}.",
];

export const ADDITION_NOTES = [
  "We buy {part} from them and want them on the list.",
  "New vendor for {part}; first purchase order planned next month.",
  "Quoted us on {part}. Please check them before we sign.",
  "Second supplier for {part}.",
  "Our plant manager met them at a trade show; they make {part}.",
  "Taking over {part} volume from a vendor we dropped.",
  "Small trial order of {part} so far.",
  "",
];

export const DECLINE_NOTES = [
  "They resell other makers' products; ask us about the maker by name and we will add it.",
  "We could not find a business by that name in that state. Check the spelling and ask again.",
  "They closed this location and stopped taking orders, so there is nothing to check.",
];
