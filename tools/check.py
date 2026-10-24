"""Explicit owner-requested tool checks. No OpenAI calls or source-file edits."""
import hashlib
import html
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPOSITORY = "NousVolition/semantic-organizer-bot"
OWNER = "NousVolition"
TITLES = {"[Check ontology]": "hermit", "[Diagram word roles]": "lambeq"}
MAX_INPUT = 48_000
OWL = "http://www.w3.org/2002/07/owl#"


def request_from_event(event):
    issue = event.get("issue", {})
    if (event.get("action") != "opened"
            or event.get("repository", {}).get("full_name") != REPOSITORY
            or issue.get("user", {}).get("login") != OWNER
            or event.get("sender", {}).get("login") != OWNER
            or "pull_request" in issue):
        raise ValueError("Only the repository owner's new tool issues are accepted.")
    tool = TITLES.get(issue.get("title"))
    if tool is None:
        raise ValueError("Use exactly [Check ontology] or [Diagram word roles].")
    body = issue.get("body") or ""
    if len(body.encode("utf-8")) > MAX_INPUT:
        raise ValueError("Input exceeds 48,000 bytes; please supply a smaller example.")
    body = body.strip()
    if tool == "hermit":
        fenced = re.fullmatch(r"```(?:xml|rdf|owl)?\s*\n([\s\S]*?)\n```", body)
        if fenced:
            body = fenced.group(1).strip()
        if not body.startswith("<"):
            raise ValueError("Paste one self-contained RDF/XML ontology, optionally in an xml code block.")
    else:
        fenced = re.fullmatch(r"```json\s*\n([\s\S]*?)\n```", body)
        if fenced:
            body = fenced.group(1).strip()
        word_roles(body)
    return {"tool": tool, "input": body,
            "input_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            "issue": issue["number"]}


def word_roles(text):
    try:
        roles = json.loads(text)
    except ValueError as error:
        raise ValueError('Supply JSON with subject, verb and object, for example {"subject":"Patterns","verb":"connect","object":"ideas"}.') from error
    if not isinstance(roles, dict) or set(roles) != {"subject", "verb", "object"}:
        raise ValueError("Supply exactly subject, verb and object; these roles are your explicit choices.")
    if any(not isinstance(value, str) or not value.strip() or len(value) > 60
           or any(ord(char) < 32 for char in value) for value in roles.values()):
        raise ValueError("Each word or phrase must contain 1 to 60 characters on one line.")
    return {key: value.strip() for key, value in roles.items()}


def normalize_ontology(text):
    # Validate XML before RDFLib sees it. No DTD, entity or import fetching.
    from defusedxml.ElementTree import fromstring
    from rdflib import Graph, OWL as OWL_NS, RDF
    fromstring(text, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    graph = Graph().parse(data=text, format="xml", publicID="https://example.invalid/input/")
    if any(graph.triples((None, OWL_NS.imports, None))):
        raise ValueError("owl:imports is not supported. Supply a self-contained ontology.")
    if not 1 <= len(graph) <= 5000:
        raise ValueError("Ontology must contain 1 to 5,000 RDF triples.")
    if not any(graph.triples((None, RDF.type, OWL_NS.Class))):
        raise ValueError("Declare at least one owl:Class so the intended vocabulary is explicit.")
    # HermiT receives normalized triples, never the original XML. Owlready2's
    # Python ontology loader is deliberately not used (it supports code hooks).
    return graph.serialize(format="nt"), len(graph)


def run_hermit(text, output):
    normalized, triples = normalize_ontology(text)
    source = output / "ontology.nt"
    source.write_text(normalized, encoding="utf-8")
    spec = importlib.util.find_spec("owlready2")
    jar = Path(spec.origin).parent / "hermit" / "HermiT.jar"
    command = ["java", "-Xmx512M", "-cp", os.pathsep.join((str(jar.parent), str(jar))),
               "org.semanticweb.HermiT.cli.CommandLine"]
    result = subprocess.run(command + ["--consistency=" + OWL + "Thing", source.as_uri()],
                            capture_output=True, text=True, timeout=90)
    (output / "hermit-consistency.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    answer = result.stdout.strip()
    contradiction = 'Exception in thread "main" org.semanticweb.owlapi.reasoner.InconsistentOntologyException: Inconsistent ontology'
    if result.returncode == 1 and result.stderr.splitlines()[:1] == [contradiction]:
        consistent = False
    elif result.returncode:
        raise RuntimeError("HermiT could not complete the check; see the run's diagnostic artifact.")
    elif answer == OWL + "Thing is satisfiable.":
        consistent = True
    elif answer == OWL + "Thing is not satisfiable.":
        consistent = False
    else:
        raise RuntimeError("HermiT returned an unrecognized consistency result.")
    unsatisfiable = None
    if consistent:
        classes = subprocess.run(command + ["-N", "-U", source.as_uri()],
                                 capture_output=True, text=True, timeout=90)
        (output / "hermit-classes.txt").write_text(classes.stdout + classes.stderr, encoding="utf-8")
        if classes.returncode:
            raise RuntimeError("Consistency completed, but HermiT's class check failed.")
        lines = classes.stdout.splitlines()
        if not lines or lines[0] != "Classes equivalent to '" + OWL + "Nothing':":
            raise RuntimeError("HermiT returned an unrecognized class result.")
        unsatisfiable = sorted(line.strip() for line in lines[1:]
                               if line.strip() and line.strip() != OWL + "Nothing")
    return {"status": "completed", "tool": "HermiT (Owlready2 bundled build)",
            "owlready2_version": importlib.metadata.version("owlready2"),
            "jar_sha256": hashlib.sha256(jar.read_bytes()).hexdigest(),
            "triple_count": triples, "consistent": consistent,
            "unsatisfiable_classes": unsatisfiable,
            "limits": "Checks only these supplied OWL axioms. Consistency does not prove the model describes reality, that missing facts are false, or that a prose argument is valid. An unsatisfiable class can exist in a consistent ontology if it has no instances."}


def run_lambeq(text, output):
    import matplotlib
    matplotlib.use("Agg")
    from lambeq.backend.grammar import Cup, Id, Ty, Word
    roles = word_roles(text)
    noun, sentence = Ty("n"), Ty("s")
    words = (Word(roles["subject"], noun)
             @ Word(roles["verb"], noun.r @ sentence @ noun.l)
             @ Word(roles["object"], noun))
    diagram = words >> (Cup(noun, noun.r) @ Id(sentence) @ Cup(noun.l, noun))
    diagram.draw(path=str(output / "sentence-diagram.svg"), figsize=(16, 5), fontsize=10)
    return {"status": "completed", "tool": "lambeq explicit word-role diagram",
            "lambeq_version": importlib.metadata.version("lambeq"),
            "roles": roles, "sentence": " ".join(roles[key] for key in ("subject", "verb", "object")),
            "output_type": str(diagram.cod),
            "boxes": [{"name": str(box.name), "input_type": str(box.dom),
                       "output_type": str(box.cod)} for box in diagram.boxes],
            "limits": "A subject-verb-object diagram using the roles you supplied, not automatic sentence parsing or confirmation that these roles are correct. The noun and verb types are assigned by this explicit template. No trained semantic comparison, truth check, quantum simulation, or quantum hardware execution was performed. Automatic parsing is not enabled in this bot; this run uses supplied word roles and does not test availability of pretrained model downloads."}


def escaped(value):
    # Plain HTML text, with mentions and Markdown syntax neutralized.
    return re.sub(r"([\\`*_{}\[\]()#+.!|>~-])", r"\\\1", html.escape(str(value))).replace("@", "&#64;")


def report(result):
    lines = ["<!-- seo-language-tool-result -->", "## Requested language tool check", ""]
    if result["status"] != "completed":
        lines += ["**Confidence: Not assessed** — The tool did not complete; no conclusion about your idea follows.", ""]
        lines += ["**Check did not complete.** No formal result is being claimed.", "", escaped(result["error"])]
    elif "consistent" in result:
        lines += ["**Confidence: High for the reported formal result within the supplied axioms; not assessed for their real-world truth.** The reasoner checked this ontology. To extend the claim, justify the axioms and their mapping to the intended domain.", ""]
        lines += ["**HermiT ran:** the supplied ontology is **" + ("consistent" if result["consistent"] else "inconsistent") + "**."]
        if result["consistent"]:
            classes = result["unsatisfiable_classes"]
            lines += ["", "Unsatisfiable named classes (excluding owl:Nothing): " + str(len(classes)) + "."]
            lines += ["- " + escaped(name) for name in classes[:20]]
            if len(classes) > 20:
                lines += ["The complete list is in result.json."]
        lines += ["", "An inconsistent result means these axioms cannot all hold together; this check does not identify a minimal explanation."] if not result["consistent"] else []
        lines += ["", escaped(result["limits"]), "", "Runtime: Owlready2 " + result["owlready2_version"] + "; bundled HermiT jar SHA-256: `" + result["jar_sha256"] + "`."]
    else:
        lines += ["**Confidence: Not assessed for the correctness of your role assignments.** lambeq constructed the diagram from the roles you supplied; it did not choose or validate them. To assess them, provide the complete sentence and intended reading, compare plausible roles, and keep alternate parses when context is ambiguous.", ""]
        lines += ["**lambeq ran:** constructed a string diagram from your explicitly supplied word roles.", "", "> " + escaped(result["sentence"]), "", "Output type: " + escaped(result["output_type"]) + ". The two noun wires connect to the verb's two argument positions, leaving one sentence wire.", "", "| Diagram element | Input type | Output type |", "| --- | --- | --- |"]
        lines += ["| " + " | ".join(escaped(box[key]) for key in ("name", "input_type", "output_type")) + " |" for box in result["boxes"][:50]]
        lines += ["", "Download **sentence-diagram.svg** from the run's **language-tool-result** artifact for the picture.", "", escaped(result["limits"]), "", "Runtime: lambeq " + result["lambeq_version"] + "."]
    if "input_sha256" in result:
        lines += ["", "Input SHA-256: `" + result["input_sha256"] + "`."]
    lines += ["", "These are tool results for the supplied input. The author decides what to do with them. No OpenAI API request was made."]
    return "\n".join(lines)


def save_result(result, output):
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")


def main():
    mode = sys.argv[1]
    output = Path("tool-output").resolve()
    output.mkdir(exist_ok=True)
    if mode == "prepare":
        try:
            event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
            request = request_from_event(event)
            (output / "request.json").write_text(json.dumps(request), encoding="utf-8")
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
                stream.write("tool=" + request["tool"] + "\n")
        except Exception as error:
            save_result({"status": "error", "error": str(error)}, output)
            raise SystemExit(1)
    elif mode == "run":
        request = json.loads((output / "request.json").read_text(encoding="utf-8"))
        try:
            child = subprocess.run([sys.executable, __file__, "worker"], capture_output=True, text=True, timeout=240)
            (output / "diagnostics.txt").write_text(child.stdout + child.stderr, encoding="utf-8")
            if child.returncode:
                raise RuntimeError("The tool failed to run. See diagnostics.txt in the run artifact; no successful check is claimed.")
            result = json.loads((output / "worker.json").read_text(encoding="utf-8"))
        except subprocess.TimeoutExpired:
            result = {"status": "error", "error": "The four-minute tool limit was reached. Try a smaller input."}
        except Exception as error:
            result = {"status": "error", "error": str(error)}
        result.update({key: request[key] for key in ("input_sha256", "input", "issue")})
        result["code_commit"] = os.environ.get("GITHUB_SHA", "local")
        save_result(result, output)
        if result["status"] != "completed":
            raise SystemExit(1)
    elif mode == "worker":
        request = json.loads((output / "request.json").read_text(encoding="utf-8"))
        runner = {"hermit": run_hermit, "lambeq": run_lambeq}[request["tool"]]
        result = runner(request["input"], output)
        (output / "worker.json").write_text(json.dumps(result), encoding="utf-8")
    else:
        raise ValueError("Unknown command")


if __name__ == "__main__":
    main()

