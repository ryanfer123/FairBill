.PHONY: eval

eval:
	cd server && .venv/bin/python -m evals.run
