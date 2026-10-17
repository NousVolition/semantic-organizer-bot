import copy
import os
from pathlib import Path
import unittest
from check import request_from_event, normalize_ontology, run_hermit, run_lambeq, report

ROOT = Path(__file__).parent
CONSISTENT = (ROOT / "examples/consistent.owl").read_text()
INCONSISTENT = (ROOT / "examples/inconsistent.owl").read_text()


class Requests(unittest.TestCase):
    def setUp(self):
        self.event = {"action": "opened", "repository": {"full_name": "NousVolition/semantic-organizer-bot"},
                      "sender": {"login": "NousVolition"},
                      "issue": {"number": 1, "user": {"login": "NousVolition"},
                                "title": "[Diagram sentence]", "body": "Patterns connect ideas."}}

    def test_owner_sentence(self):
        request = request_from_event(self.event)
        self.assertEqual(request["tool"], "lambeq")
        self.assertEqual(len(request["input_sha256"]), 64)

    def test_untrusted_events_rejected(self):
        for field, key, value in [("repository", "full_name", "other/repo"),
                                  ("sender", "login", "other"), ("issue", "title", "[Diagram sentence] extra")]:
            event = copy.deepcopy(self.event)
            event[field][key] = value
            with self.assertRaises(ValueError):
                request_from_event(event)
        self.event["issue"]["user"]["login"] = "other"
        with self.assertRaises(ValueError):
            request_from_event(self.event)

    def test_fenced_ontology_and_limits(self):
        self.event["issue"].update(title="[Check ontology]", body="```xml\n" + CONSISTENT + "\n```")
        self.assertEqual(request_from_event(self.event)["input"], CONSISTENT.strip())
        self.event["issue"]["body"] = "x" * 48001
        with self.assertRaises(ValueError):
            request_from_event(self.event)

    def test_sentence_limits_and_no_false_success(self):
        for text in ("", "a\nb", "x" * 201, "a\tb"):
            self.event["issue"]["body"] = text
            with self.assertRaises(ValueError):
                request_from_event(self.event)
        self.assertIn("No formal result", report({"status": "error", "error": "timeout"}))
        self.assertNotIn("**HermiT ran", report({"status": "error", "error": "timeout"}))


@unittest.skipUnless(os.environ.get("TEST_LANGUAGE_TOOL") == "hermit", "HermiT integration job only")
class HermiT(unittest.TestCase):
    def run_case(self, name, text):
        output = Path("tool-smoke", name).resolve()
        output.mkdir(parents=True, exist_ok=True)
        return run_hermit(text, output)

    def test_consistent(self):
        result = self.run_case("consistent", CONSISTENT)
        self.assertTrue(result["consistent"])
        self.assertEqual(result["unsatisfiable_classes"], [])

    def test_contradiction(self):
        result = self.run_case("inconsistent", INCONSISTENT)
        self.assertFalse(result["consistent"])
        self.assertIsNone(result["unsatisfiable_classes"])

    def test_empty_impossible_class_is_not_inconsistent_ontology(self):
        text = CONSISTENT.replace('</rdf:RDF>', '<owl:Class rdf:about="#Impossible"><rdfs:subClassOf rdf:resource="http://www.w3.org/2002/07/owl#Nothing"/></owl:Class></rdf:RDF>')
        result = self.run_case("unsatisfiable", text)
        self.assertTrue(result["consistent"])
        self.assertEqual(result["unsatisfiable_classes"], ["https://example.org/concepts#Impossible"])

    def test_import_and_external_entity_rejected(self):
        text = CONSISTENT.replace('<owl:Ontology rdf:about="https://example.org/concepts"/>', '<owl:Ontology rdf:about="https://example.org/concepts"><owl:imports rdf:resource="file:///etc/passwd"/></owl:Ontology>')
        with self.assertRaisesRegex(ValueError, "imports"):
            normalize_ontology(text)
        from defusedxml.common import DefusedXmlException
        with self.assertRaises(DefusedXmlException):
            normalize_ontology(CONSISTENT.replace('<?xml version="1.0"?>', '<!DOCTYPE rdf:RDF [<!ENTITY x SYSTEM "file:///etc/passwd">]>'))


@unittest.skipUnless(os.environ.get("TEST_LANGUAGE_TOOL") == "lambeq", "lambeq integration job only")
class Lambeq(unittest.TestCase):
    def test_real_parser_and_diagram(self):
        output = Path("tool-smoke/lambeq").resolve()
        output.mkdir(parents=True, exist_ok=True)
        result = run_lambeq("Patterns connect ideas.", output)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["output_type"], "s")
        self.assertTrue(any(box["name"] == "connect" for box in result["boxes"]))
        self.assertIn("<svg", (output / "sentence-diagram.svg").read_text())
        self.assertIn("No trained semantic comparison", result["limits"])


if __name__ == "__main__":
    unittest.main()
