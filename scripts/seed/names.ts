import type { Seed } from "../../src/db.js";

type Kind = Seed["suppliers"][number]["kind"];

export const LOCAL_PASSWORD = "supplier-desk-local";

export const STAFF: { id: number; name: string; email: string; role: Seed["staff"][number]["role"] }[] = [
  { id: 1, name: "Ingrid Solberg", email: "ingrid@tessary.example", role: "lead" },
  { id: 2, name: "Marcus Oyelaran", email: "marcus@tessary.example", role: "analyst" },
  { id: 3, name: "Teresa Villanueva", email: "teresa@tessary.example", role: "analyst" },
  { id: 4, name: "Gordon Przybylski", email: "gordon@tessary.example", role: "analyst" },
  { id: 5, name: "Lindsay Carvalho", email: "lindsay@tessary.example", role: "analyst" },
  { id: 6, name: "Hakeem Odum", email: "hakeem@tessary.example", role: "analyst" },
  { id: 7, name: "Brenna Sato", email: "brenna@tessary.example", role: "analyst" },
  { id: 8, name: "Victor Hlavaty", email: "victor@tessary.example", role: "analyst" },
  { id: 9, name: "Corinne Waldrop", email: "corinne@tessary.example", role: "admin" },
];

export const LEAD_ID = 1;
export const ANALYST_IDS = [2, 3, 4, 5, 6, 7, 8];

export interface ClientSpec {
  name: string;
  slug: string;
  industry: string;
  city: string;
  state: string;
  parts: string[];
  kinds: Partial<Record<Kind, number>>;
}

export const CLIENTS: ClientSpec[] = [
  { name: "Kessler-Damon Molded Fiber", slug: "kesslerdamon", industry: "Food packaging", city: "Tollhurst", state: "MN", parts: ["pulp", "carton stock", "stretch film"], kinds: { raw_materials: 3, packaging: 3, freight: 2 } },
  { name: "Varnum Fluid Controls", slug: "varnumfluid", industry: "Industrial valves", city: "Pickett Mill", state: "OH", parts: ["valve bodies", "stem castings", "seals"], kinds: { components: 4, raw_materials: 2, freight: 1 } },
  { name: "Oxbury Seating Company", slug: "oxbury", industry: "Office furniture", city: "Lanier Springs", state: "NC", parts: ["seat foam", "casters", "steel tube"], kinds: { components: 3, raw_materials: 3, contract_manufacturer: 1 } },
  { name: "Meridale Medical Disposables", slug: "meridale", industry: "Medical disposables", city: "Corran Falls", state: "WI", parts: ["tubing", "resin", "sterile pouches"], kinds: { contract_manufacturer: 3, raw_materials: 2, packaging: 2 } },
  { name: "Haddon & Pyke Cabinetry", slug: "haddonpyke", industry: "Kitchen cabinets", city: "Sudbrook", state: "IN", parts: ["hardwood", "hinges", "finish coatings"], kinds: { raw_materials: 4, components: 2, freight: 1 } },
  { name: "Brenner Tate Fasteners", slug: "brennertate", industry: "Industrial fasteners", city: "Rosshaven", state: "PA", parts: ["wire rod", "plating", "cartons"], kinds: { raw_materials: 3, contract_manufacturer: 2, packaging: 1 } },
  { name: "Selbury Pet Foods", slug: "selbury", industry: "Pet food", city: "Hartsel Junction", state: "KS", parts: ["multiwall bags", "labels", "pallets"], kinds: { packaging: 4, raw_materials: 2, freight: 2 } },
  { name: "Northam Lighting Works", slug: "northam", industry: "Commercial lighting", city: "Vosburg", state: "IL", parts: ["LED drivers", "aluminum extrusions", "lenses"], kinds: { components: 4, raw_materials: 2, contract_manufacturer: 1 } },
  { name: "Tensley Hydraulics", slug: "tensley", industry: "Hydraulic cylinders", city: "Cavell Bend", state: "IA", parts: ["chrome bar", "seal kits", "machined rods"], kinds: { components: 3, raw_materials: 3, contract_manufacturer: 1 } },
  { name: "Fairhurst Outdoor Products", slug: "fairhurst", industry: "Outdoor power equipment parts", city: "Glensboro", state: "TN", parts: ["small engines", "blades", "molded housings"], kinds: { components: 3, contract_manufacturer: 2, freight: 1 } },
  { name: "Cardale Lab Plastics", slug: "cardale", industry: "Laboratory plastics", city: "Keswick Hollow", state: "NJ", parts: ["polypropylene resin", "racks", "cleanroom bags"], kinds: { raw_materials: 3, packaging: 2, contract_manufacturer: 2 } },
  { name: "Quarrier Bakeware", slug: "quarrier", industry: "Commercial bakeware", city: "Tillman's Ford", state: "AL", parts: ["aluminized steel", "coatings", "corrugated boxes"], kinds: { raw_materials: 3, packaging: 2, components: 1 } },
  { name: "Halberd Truck Parts", slug: "halberd", industry: "Heavy truck aftermarket parts", city: "Odell Cross", state: "TX", parts: ["brake castings", "air fittings", "freight"], kinds: { components: 4, freight: 2, contract_manufacturer: 1 } },
  { name: "Lindell Mattress Company", slug: "lindell", industry: "Mattresses", city: "Cassidy Gap", state: "GA", parts: ["foam", "innerspring units", "ticking fabric"], kinds: { raw_materials: 4, components: 2, freight: 2 } },
  { name: "Thornbury Housewares", slug: "thornbury", industry: "Kitchenware", city: "Esmond Crossing", state: "MO", parts: ["stainless coil", "handles", "retail cartons"], kinds: { raw_materials: 2, contract_manufacturer: 3, packaging: 2 } },
  { name: "Kinnaird Filtration", slug: "kinnaird", industry: "HVAC filters", city: "Dorrit Station", state: "SC", parts: ["filter media", "chipboard frames", "freight"], kinds: { raw_materials: 3, packaging: 2, freight: 2 } },
];

export const ENDED_CLIENT = "Cardale Lab Plastics";

export const SUPPLIER_ROOTS = [
  "Acheson", "Adair", "Albrecht", "Amundsen", "Anselm", "Arbogast", "Ardrey", "Arnett", "Atwell", "Aucoin",
  "Averill", "Bainbridge", "Balfour", "Bancroft", "Barnhart", "Beaumier", "Beckwith", "Benedetti", "Bergstrom", "Birdsall",
  "Blackwood", "Blevins", "Bodine", "Bonner", "Bouchard", "Bracewell", "Brannigan", "Breckner", "Brightman", "Buckland",
  "Burnside", "Caddell", "Calhoun", "Cantrell", "Carbery", "Carmody", "Carrick", "Cashdollar", "Caverly", "Chadwell",
  "Chastain", "Clevenger", "Corrado", "Cosgrove", "Cottrell", "Crandall", "Creighton", "Crowder", "Culpepper", "Cunliffe",
  "Dalrymple", "Darrow", "Deveraux", "Dillard", "Dinsmore", "Doherty", "Donnelly", "Drummond", "Dufresne", "Dunbar",
  "Durrant", "Eakins", "Eberhardt", "Edgerton", "Eldridge", "Ellingson", "Emmerich", "Engstrom", "Epling", "Everhart",
  "Falconer", "Farnsworth", "Faulk", "Fennell", "Fetterman", "Finnegan", "Fitzhugh", "Forsberg", "Fosdick", "Frawley",
  "Fredrickson", "Gadsden", "Gallatin", "Gaskell", "Gentry", "Gerhardt", "Giddings", "Gillespie", "Gladwell", "Gossett",
  "Grafton", "Greenleaf", "Griggs", "Grunwald", "Guthrie", "Hackworth", "Hagstrom", "Halloran", "Hammill", "Hanrahan",
  "Harbaugh", "Harkness", "Hartsell", "Hawley", "Heberling", "Hedlund", "Hightower", "Hilliard", "Hochstetler", "Holcomb",
  "Holloway", "Hornsby", "Houlihan", "Huckaby", "Hufnagel", "Hurlbut", "Isaacson", "Jansky", "Jarrell", "Jeffords",
  "Jorgensen", "Judkins", "Kaufer", "Keegan", "Kellerman", "Kennerly", "Kerrigan", "Kessinger", "Kilbride", "Knutson",
  "Kreider", "Lachman", "Lambright", "Langford", "Larrabee", "Lassiter", "Laughlin", "Leavitt", "Ledbetter", "Lehmann",
  "Lightfoot", "Lindberg", "Lockridge", "Loftus", "Lundgren", "Macready", "Maddox", "Mahaffey", "Malloy", "Markley",
  "Marsden", "Mattingly", "Maxfield", "McAllister", "McCandless", "McGivney", "Meacham", "Metzger", "Montague", "Moorcroft",
  "Mulcahy", "Nagle", "Neidhart", "Nesbitt", "Nicholls", "Norgaard", "Nygaard", "Oberlin", "Odegaard", "Ogilvie",
  "Oldfield", "Orlov", "Osgood", "Ottley", "Paddock", "Palfrey", "Parmenter", "Pasternak", "Penrod", "Pettibone",
  "Platt", "Plunkett", "Pomeroy", "Prescott", "Pritchard", "Pulaski", "Quigley", "Radcliffe", "Ransom", "Rathbone",
  "Redmond", "Reinhart", "Renfro", "Rhinehart", "Ridgeway", "Rutledge", "Sackett", "Salinger", "Sandifer", "Satterfield",
  "Scarborough", "Schermerhorn", "Schofield", "Selden", "Shackleford", "Shattuck", "Shiflett", "Slocum", "Southerland", "Spofford",
  "Stallworth", "Standish", "Steadman", "Stockdale", "Stroud", "Sturgis", "Sutcliffe", "Swanbeck", "Tadlock", "Tallmadge",
  "Thackeray", "Thurgood", "Tillery", "Torgerson", "Trautman", "Treadway", "Truesdale", "Tunstall", "Tweedy", "Upchurch",
  "Vandenberg", "Vanderpool", "Varnell", "Villiers", "Voorhees", "Waddell", "Wallingford", "Warrick", "Weidner", "Westbrook",
  "Whitacre", "Whitford", "Wickersham", "Wilburn", "Winslow", "Witherspoon", "Woodbury", "Wyckoff", "Yarnell", "Youngblood",
  "Zabel", "Abelson", "Ainsley", "Ballantyne", "Bettencourt", "Blaylock", "Boatwright", "Bramlett", "Brubaker", "Cheever",
  "Claypool", "Coldiron", "Dorsett", "Dunaway", "Eckels", "Fairweather", "Fortney", "Gartrell", "Gilmartin", "Haldane",
  "Hammerstrom", "Hockett", "Ivanoff", "Kimbrough", "Kirschner", "Lamoreaux", "Lockwood-Hale", "Mabie", "Mcelwee", "Nordby",
];

export const KIND_SUFFIXES: Record<Kind, string[]> = {
  raw_materials: ["Polymers", "Resins", "Steel Service", "Alloys", "Paperboard", "Hardwood Lumber", "Specialty Chemicals", "Textile Mills", "Aluminum", "Foam Products", "Wire & Rod", "Coatings"],
  components: ["Precision", "Die Casting", "Machining", "Fastener Co.", "Springs & Stampings", "Electric Motors", "Gear Works", "Castings", "Hydraulic Components", "Caster & Wheel", "Electronics", "Seal Co."],
  packaging: ["Corrugated", "Labels", "Folding Carton", "Flexible Packaging", "Container", "Thermoforming", "Pallet", "Bag Co.", "Tube & Core"],
  freight: ["Freight Lines", "Transport", "Logistics", "Trucking", "Carriers", "Express"],
  contract_manufacturer: ["Contract Manufacturing", "Assembly", "Molding", "Fabrication", "Industries", "Medical Products", "Manufacturing Services"],
};

export const KIND_COUNTS: [Kind, number][] = [
  ["raw_materials", 62],
  ["components", 70],
  ["packaging", 52],
  ["freight", 28],
  ["contract_manufacturer", 48],
];

export const TOWNS: [string, string][] = [
  ["Alcott Springs", "TN"], ["Amberton", "OH"], ["Ansel Ridge", "KY"], ["Arrowhead Flats", "TX"], ["Ballard Mills", "NC"],
  ["Bentham Ridge", "IN"], ["Blaine Station", "GA"], ["Bramwell Gap", "WV"], ["Briarton", "SC"], ["Buckner Ferry", "AL"],
  ["Cannonbrook", "MN"], ["Carlow Station", "IA"], ["Chesterline", "PA"], ["Clover Bottom", "TN"], ["Corliss Hollow", "WI"],
  ["Crestline Junction", "OH"], ["Darby Mills", "SC"], ["Dennard Springs", "AR"], ["Dovetail", "MI"], ["Eckley Bluff", "PA"],
  ["Elsworth Prairie", "KS"], ["Emery Shoals", "NC"], ["Fairmount Hill", "IN"], ["Fenwick Lake", "MI"], ["Fletcher Bend", "MS"],
  ["Gable Mills", "KY"], ["Garrison Flats", "NE"], ["Glover Station", "VA"], ["Halston Prairie", "OK"], ["Hatcher Creek", "GA"],
  ["Hemlock Run", "PA"], ["Heron Point", "LA"], ["Hickory Knob", "MO"], ["Horton Mills", "WI"], ["Hyland Center", "IL"],
  ["Ingram Ridge", "TN"], ["Jasper Hollow", "AL"], ["Juniper Gap", "CO"], ["Keenesburg Flats", "NY"], ["Kinsey Run", "OH"],
  ["Lacey Prairie", "IA"], ["Lambert Ford", "MO"], ["Langdon Springs", "TX"], ["Laurel Cove", "KY"], ["Lisle Center", "IL"],
  ["Locust Hollow", "VA"], ["Lowell Bend", "IN"], ["Macklin Springs", "SD"], ["Marrowbone", "TN"], ["Meadville Flats", "OH"],
  ["Millbrae Junction", "GA"], ["Moncure Hill", "NC"], ["Mossy Ford", "AR"], ["Nesbitt Corner", "MS"], ["Newcomb Ridge", "NY"],
  ["Noble Station", "OK"], ["Oakum Point", "MA"], ["Olmstead Falls", "MN"], ["Ozark Bend", "MO"], ["Paxton Mills", "NE"],
  ["Pettus Bend", "TX"], ["Pinnacle Rock", "UT"], ["Plovers Landing", "WI"], ["Quincy Flats", "WA"], ["Radford Hill", "VA"],
  ["Ravenna Junction", "OH"], ["Redfield Crossing", "IA"], ["Rexford Bluff", "KS"], ["Rockport Mills", "IN"], ["Rushmore Gap", "SD"],
  ["Salter Springs", "SC"], ["Seneca Ridge", "PA"], ["Shelby Ford", "KY"], ["Silverdale Springs", "WA"], ["Sloan Valley", "IA"],
  ["Spencer Mills", "WV"], ["Stanwick Mills", "OR"], ["Stillwell Junction", "OK"], ["Strathmore Bend", "AL"], ["Sugar Run", "PA"],
  ["Tabor Hill", "MI"], ["Tarrant Mills", "TX"], ["Thayer Crossing", "MO"], ["Timberlane Mills", "GA"], ["Tolland Flats", "CT"],
  ["Trenary Bend", "MI"], ["Tuckahoe Bend", "NJ"], ["Tyrone Mills", "PA"], ["Upton Ridge", "WY"], ["Valmont Ridge", "IL"],
  ["Vantage Point", "WA"], ["Verdigris Bend", "OK"], ["Wadley Bluff", "AL"], ["Walnut Shoals", "NC"], ["Warren Mills", "MO"],
  ["Wayland Flats", "MI"], ["Wexford Hill", "PA"], ["Whitlow Springs", "AR"], ["Wildwood Station", "FL"], ["Winfield Bend", "KS"],
  ["Woodcliff Mills", "NJ"], ["Yadkin Falls", "NC"], ["Yatesboro", "KS"], ["Zion Grove", "PA"], ["Abington Mills", "MA"],
  ["Belmar Junction", "NE"], ["Calvary Hill", "GA"], ["Delmont Flats", "SD"], ["Eustace Mill", "TX"], ["Farley Station", "IA"],
  ["Gilman Springs", "CA"], ["Hartwell Mills", "GA"], ["Ironmere", "MO"], ["Jessamine Ford", "KY"], ["Kingsmere Flats", "ME"],
  ["Loveland Gap", "CO"], ["Mansfield Bend", "LA"], ["Norwood Junction", "OH"], ["Orland Mills", "IN"], ["Pocahontas Flats", "AR"],
  ["Quaker Hill", "CT"], ["Riverbend Station", "MS"], ["Saluda Ridge", "SC"], ["Talmage Wells", "NE"], ["Union Grove Mills", "TN"],
  ["Vernon Falls", "WI"], ["Weldon Spring", "MO"], ["Yorkshire Bend", "VA"], ["Arcola Flats", "IL"], ["Bonnard", "SC"],
  ["Coalton Gap", "OH"], ["Deerlick Run", "WV"], ["Elkader Bend", "IA"], ["Florence Mills", "AL"], ["Grayling Junction", "MI"],
  ["Hampstead Mills", "NC"], ["Ironton Flats", "MN"], ["Kearney Mills", "NE"], ["Lorrimer Bluff", "NY"], ["Monroe Gap", "GA"],
];

export const PE_FIRMS = [
  "Stonepath Capital Partners", "Kinlock Equity", "Mill Race Capital", "Copper Kiln Partners", "Northfork Equity Partners",
  "Lantern Rock Capital", "Sedgefield Partners", "Hartline Industrial Partners", "Switchgrass Equity", "Pine Hollow Partners",
];

export const PARENTS = [
  "Calvert-Moss Industries", "Draycott Holdings", "Tremaine Packaging Group", "Ashcombe Industrial", "Brantwood Manufacturing Group",
  "Holcroft Logistics Holdings", "Strickfield Components Group", "Mossgiel Holdings", "Elmsworth Group", "Kittredge Materials",
  "Ravelle Industrial Corp.", "Duncairn Holdings",
];

export const FIRST_NAMES = [
  "Abby", "Adrian", "Agnes", "Alicia", "Allan", "Amos", "Angela", "Arlene", "Austin", "Barry",
  "Benita", "Brandon", "Brent", "Bridget", "Byron", "Camille", "Carl", "Carla", "Chad", "Charlene",
  "Clint", "Colleen", "Craig", "Dana", "Darlene", "Dean", "Denise", "Derek", "Dina", "Doug",
  "Duane", "Elena", "Elliot", "Erin", "Ernest", "Faye", "Francine", "Garrett", "Gina", "Grant",
  "Greg", "Hannah", "Heidi", "Howard", "Ian", "Ines", "Jackie", "Jared", "Javier", "Jenna",
  "Joel", "Jorge", "Josie", "Julian", "Karen", "Kelly", "Kurt", "Lance", "Laurie", "Leon",
  "Lisa", "Lonnie", "Lyle", "Marla", "Martin", "Maureen", "Megan", "Mitch", "Monica", "Nathan",
  "Noreen", "Pam", "Paul", "Phil", "Quentin", "Ramon", "Regina", "Rick", "Rita", "Robin",
  "Roger", "Ruth", "Sean", "Shirley", "Stacy", "Stuart", "Tamara", "Ted", "Tina", "Todd",
  "Tracy", "Trevor", "Val", "Vince", "Walt", "Wendy", "Yvonne", "Hugo", "Lorna", "Gustavo",
];

export const LAST_NAMES = [
  "Agarwal", "Amato", "Baptiste", "Barrera", "Beltran", "Benoit", "Bishop", "Blum", "Brady", "Bui",
  "Cabrera", "Cardenas", "Carlisle", "Chavez", "Cho", "Cline", "Corbett", "Crane", "Cruz", "Dang",
  "Decker", "Diaz", "Donovan", "Doyle", "Duarte", "Duong", "Eaton", "Ellison", "Espinoza", "Farrell",
  "Fischer", "Flynn", "Foley", "Fuentes", "Galvan", "Garza", "Gibbs", "Goldberg", "Gonzales", "Grimes",
  "Guerrero", "Hahn", "Hale", "Hammond", "Hanna", "Hays", "Herrera", "Hoang", "Horne", "Hughes",
  "Jensen", "Joyner", "Kang", "Keller", "Kim", "Klein", "Koch", "Krueger", "Lam", "Lara",
  "Leblanc", "Lowe", "Lu", "Lynch", "Macias", "Mack", "Marsh", "Medina", "Mejia", "Molina",
  "Moran", "Munoz", "Nash", "Navarro", "Nguyen", "Novak", "Nolan", "O'Brien", "Ortega", "Pace",
  "Patel", "Peck", "Pham", "Pierce", "Quinn", "Ramos", "Reyes", "Rhodes", "Rojas", "Ross",
  "Russo", "Salazar", "Santos", "Schmidt", "Shah", "Singh", "Soto", "Stein", "Strickland", "Suarez",
  "Tran", "Trujillo", "Vu", "Wade", "Walsh", "Weber", "Wolfe", "Wong", "Yoder", "Zhang",
];

export const CERTIFICATIONS: Record<Kind, string[]> = {
  raw_materials: ["ISO 9001:2015", "ISO 14001:2015", "FSSC 22000", "FSC chain of custody", "ISO 45001"],
  components: ["ISO 9001:2015", "IATF 16949", "AS9100D", "ISO 14001:2015", "UL recognized component"],
  packaging: ["ISO 9001:2015", "SQF Food Safety (packaging)", "BRCGS Packaging", "FSC chain of custody", "G7 Master"],
  freight: ["SmartWay partner", "C-TPAT", "Hazmat endorsement fleet", "ISO 9001:2015"],
  contract_manufacturer: ["ISO 13485:2016", "ISO 9001:2015", "FDA registered", "ISO 14644 Class 8 cleanroom", "IATF 16949"],
};

export const CONTACT_TITLES: Record<Kind, string[]> = {
  raw_materials: ["Plant Manager", "Quality Manager", "Sales Manager", "Controller", "Customer Service Lead", "VP Operations"],
  components: ["Plant Manager", "Quality Manager", "Account Manager", "Controller", "Production Scheduler", "VP Operations"],
  packaging: ["Plant Manager", "Quality Manager", "Account Manager", "Customer Service Manager", "Controller"],
  freight: ["Terminal Manager", "Safety Director", "Account Executive", "Controller", "Dispatch Manager"],
  contract_manufacturer: ["Program Manager", "Quality Manager", "Plant Manager", "Controller", "Business Development Manager"],
};
