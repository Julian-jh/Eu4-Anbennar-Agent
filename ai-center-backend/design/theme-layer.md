# EU4 and Anbennar theme layer

**Proposed logical model.** In the administration platform, **Data → Taxonomy** owns the vocabulary of domains and subjects. **Semantic layer** uses that vocabulary to classify individual game records and describe how they relate. A dataset such as *Mission reference* can supply records to several subjects.

## Domains and subjects

Give each published record one primary subject. Choose the subject that best answers “What would a player look this up to understand?” Add a secondary subject when the record directly explains another topic. A named country, province or reward can usually be represented by a relationship.

| Domain | Initial subjects | Example lookup |
|---|---|---|
| Governance & succession | Countries & names, Monarchs & reigns, Country formation, Government & estates, Internal stability | Which countries can I form? Who holds the throne? |
| Land & expansion | Provinces & regions, Cores & administration, Development & buildings, Exploration & settlement | How can an adventuring company settle? |
| Economy & trade | Treasury & debt, Goods & production, Trade networks | What increases my trade power in a node? |
| Diplomacy & subjects | Relations & alliances, Subject states & unions, Coalitions | What kind of subject is a Soyurghal? |
| Warfare | Recruitment & forces, Naval warfare, Battles & sieges, War goals & peace | What determines whether a siege progresses? |
| Peoples & faiths | Cultures, Species & minorities, Religions & conversion, Tolerance | How do minorities work in an Anbennar province? |
| Technology & progression | Technologies, Institutions, Ideas & policies, Ages, Campaign progression | What unlocks a technology? How do mission prerequisites work? |
| Magic & artificery | Schools & spells, Magical resources & projects, Artificer inventions | How do I unlock an Insyaan invention? |

The first seven domains provide a shared vocabulary. Populate each subject only for the corpora where evidence exists. The eighth gives major Anbennar systems a direct home. The headings and classifications are platform design choices. The games supply the concepts and examples. [EU4 mechanics overview](https://www.paradoxinteractive.com/games/europa-universalis-iv/about) · [Winds of Change features](https://www.paradoxinteractive.com/games/europa-universalis-iv/add-ons/europa-universalis-iv-winds-of-change) · [Anbennar's EU4 release](https://steamcommunity.com/sharedfiles/filedetails/?id=1385440355) · [Anbennar developer diary on Insyaa](https://www.reddit.com/r/Anbennar/comments/1sfx29k/eu4_dev_diary_117_welcome_to_insyaa/)

## How a record is classified

| Dimension | Example values | What it lets the administrator or assistant do |
|---|---|---|
| Corpus | EU4, Anbennar, Real History | Select the world or body of evidence. |
| Domain → subject | Diplomacy & subjects → Subject states & unions | Find records about a particular topic across content kinds. |
| Record kind | Mechanic, mission tree, mission, event, decision, modifier, country, subject type, invention | Find all events or missions in a corpus, then narrow by topic. |
| Linked entity | Country, province, estate, religion, resource | Find missions available to a country or decisions affecting a particular estate. |
| Release context | EU4 patch, Anbennar release or commit, enabled DLC | Resolve the applicable definition of a record. |

In the current demo a source or dataset has one assigned subject. Retain it as an optional catalog default. An import can propose that default, and an administrator can confirm or change it per record. A mixed collection can remain unassigned. The demo's *Game systems → Missions and events* is useful as an existing catalog label. Preserve it for existing assets. New record searches for missions and events use the kind filter. General explanations of how mission prerequisites work fit under *Technology & progression → Campaign progression*.

## Minimum logical records

| Record | Grain and essential fields |
|---|---|
| Domain, Subject | One domain has many subjects. Each subject has a stable ID, one parent domain, a label and a short inclusion rule. Renaming either preserves existing assignments. |
| Corpus, Release | A release identifies a source snapshot within a corpus. For games capture the base patch, optional mod release or commit, source channel and enabled DLC. For history use the evidence collection edition. |
| Record, Record revision | A record is one identity within a corpus, kind and qualified key. A revision holds its definition for one release, with localized names. Stable import keys keep renamed display labels and repeated imports attached to the same identity. |
| Revision subject | Links a revision to a subject, with role primary or secondary. Require exactly one primary for a published revision. A draft can await classification. |
| Rule block | Stores a revision's availability, triggers, choices or effects with scope, nesting and ordering. Keep the source expression so alternatives, option-specific effects and DLC requirements survive extraction. |
| Relation | Connects revisions in a release using a named relationship such as belongs to tree, available to country, requires mission, triggers event or grants modifier. An optional rule-block reference identifies the choice or condition under which it applies. |
| Evidence | Links a revision, rule block or relation to a source asset revision and a precise locator, such as a script key and line range, PDF page, web heading or database row key. A record may have multiple citations. |

Game identity includes the corpus. An EU4 tag, an Anbennar tag and a historical country's name can coincide. Keep their IDs independent and use an explicit mapping for comparisons. For an Anbennar query, resolve definitions against the selected mod build and its EU4 base. An inherited rule needs evidence that it still applies in that build. The Workshop release and the development repository are separate inputs. [Anbennar release](https://steamcommunity.com/sharedfiles/filedetails/?id=1385440355) · [Mod team repository](https://gitlab.com/anbennar/anbennar-eu4-dev)

## Questions that exercise the model

1. **Which French missions concern centralization?** Select EU4 and its release, filter to the mission kind, follow the country link to France, then select *Governance & succession*. France's published mission tree also covers religious conflict and expansion. Classify its individual missions according to their objectives. Exact triggers and rewards need a script citation for the selected release. [Paradox's Domination overview](https://www.paradoxinteractive.com/games/europa-universalis-iv/add-ons/europa-universalis-iv-domination)
2. **How does exploring a Gene Pillar lead to artificery?** Classify the expedition under *Land & expansion → Exploration & settlement* and the invention under *Magic & artificery → Artificer inventions*. Link the discovery to what it helps unlock. This lets a question from either side lead to the other. The developer diary describes the connection. Import the shipped scripts to establish each invention's exact eligibility and timing. [Anbennar developer diary on Insyaa](https://www.reddit.com/r/Anbennar/comments/1sfx29k/eu4_dev_diary_117_welcome_to_insyaa/)
3. **Who ruled a country on a given date?** For Real History, use only *Countries & names* and *Monarchs & reigns*. Maintain Country, Monarch, dated Country name, and Reign linking a monarch to a country. Store dates, date precision and citations to support the lookup. Accept queries in 1444–1820 inclusive and retain source intervals overlapping that window, including a reign that began before 1444. For precise dates use an inclusive start and exclusive end, with separate states for an unknown end and an explicitly open interval.

The first implementation can use one mission tree, one Anbennar mechanic with a cross-theme relationship, and one historical reign register as fixtures. Together they test taxonomy, record kinds, source evidence, release selection and date lookup.
