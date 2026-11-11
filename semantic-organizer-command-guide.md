# Semantic Organizer Bot: commands and task guide

[NousVolition](https://github.com/NousVolition) · [Full bot documentation](README.md)

Use the exact issue titles below in this bot repository. These commands are restricted to NousVolition. Model reviews publish replies on the issue and use the configured API; submit material intended for public review.

## Find the right command

| Task | Exact issue title | What it does |
| --- | --- | --- |
| Preview the sources before language analysis | `[Discover language] preview` | Reads the first source batch and reports coverage without an OpenAI request |
| Explore language and connections | `[Discover language]` | Generates and reviews findings from the source batch |
| Review one idea in context | `[Review idea]` | Uses the wording, intended meaning and evidence supplied in the issue |
| Resume a saved reading | `[Discover language] continue 123` | Continues the reading recorded in issue 123 with its pinned sources and settings |
| Recheck a published bot report | `[Discover language] review report 45` | Reviews the findings in issue 45 against their original public source passages |
| Review selected source documents | `[Discover language] sources` | Reads two to four permitted text files at exact GitHub commits; see the required JSON format below |
| Check an OWL ontology with HermiT | `[Check ontology]` | Checks the supplied ontology's consistency and named classes |
| Draw explicit word roles with lambeq | `[Diagram word roles]` | Draws the supplied subject, verb and object assignments |

Replace example issue numbers with the relevant report's number. For the two formal-tool commands, use the [issue templates](https://github.com/NousVolition/semantic-organizer-bot/issues/new/choose) and follow the [input formats and limits](README.md#run-hermit-or-lambeq).

## Source formats, setup and recovery

- [Selected public sources and JSON format](README.md#review-selected-public-sources-through-the-publication-workflow)
- [Language discovery, source coverage and example checks](README.md#discover-language-across-repositories)
- [Editable language rulebook](language-skills.md) and [corpus definitions](corpus-definitions.md)
- [Recovery storage setup](README.md#recovery-storage-setup)
- [Render setup](README.md#easiest-way-to-turn-it-on-render)
- [Local development and tests](README.md#local-development-and-tests)

HermiT and lambeq run through their separate GitHub Actions commands. HermiT checks the supplied axioms; lambeq draws explicitly assigned roles. The model's language reviews remain fallible and do not establish those assignments or source claims as formally proved.

## More from NousVolition

- [Hug and SIMS Lean proofs](https://github.com/NousVolition/hug-sims-lean-proofs)
- [Streams and Rocks](https://github.com/NousVolition/Nous-Volition)
- [SIMS, fluid memory and language studies](https://github.com/NousVolition/My-Sources-Project-ALL)
