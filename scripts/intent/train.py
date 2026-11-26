"""Build FairBill's small offline text classifier from labelled synthetic requests."""
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

STOPWORDS = set("a an are as at be by can could do for from get how i is it me my of on or please should that the them these this to was were what when where which who will with would you your".split())

ROOT = Path(__file__).resolve().parents[2]


def features(text):
    words = re.findall(r"[a-z0-9]+", text.lower())
    words = [word for word in words if word not in STOPWORDS]
    keys = set(words)
    for word in words:
        padded = f"^{word}$"
        keys.update(f"~{padded[i:i+3]}" for i in range(len(padded) - 2))
    return keys


def read(filename):
    return [tuple(line.split("\t", 1)) for line in (Path(__file__).parent / filename).read_text().splitlines()]


def train():
    rows = [(label, features(text)) for label, text in read("train.tsv")]
    document_counts = Counter(feature for _, terms in rows for feature in terms)
    weights = {term: round(math.log(1 + len(rows) / count), 5) for term, count in document_counts.items()}
    centroids = defaultdict(Counter)
    for label, terms in rows:
        vector = {term: weights[term] * (0.45 if term.startswith("~") else 1) for term in terms if term in weights}
        length = math.sqrt(sum(value * value for value in vector.values()))
        centroids[label].update({term: value / length for term, value in vector.items()})
    normalized = {label: {term: round(value / math.sqrt(sum(v*v for v in vector.values())), 5)
                           for term, value in sorted(vector.items())} for label, vector in sorted(centroids.items())}
    return {"weights": weights, "centroids": normalized}


if __name__ == "__main__":
    output = ROOT / "mobile/src/case-intent-weights.json"
    output.write_text(json.dumps(train(), sort_keys=True, separators=(",", ":")) + "\n")
