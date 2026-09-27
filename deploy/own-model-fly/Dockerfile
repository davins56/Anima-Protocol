# The steward's own model (server/server.py) on Fly.io: the tiny GPT from
# training/ served over an OpenAI-compatible API that learns from lessons
# taught in the app. Point the api-server's ANIMA_OWN_LLM_BASE_URL at
# https://<app>.fly.dev/v1 and set ANIMA_OWN_LLM_API_KEY to ANIMA_SERVER_TOKEN.
#
# Build from the repository root (deploy/own-model-fly/deploy.sh does this) so
# the trained files can be copied in. They are gitignored, never committed:
#   out/anima-dpo/ckpt.pt            (phase 3 output — or set CKPT_SRC)
#   data/anima_tokens/tokenizer.json (phase 1 output)
#   data/anima_tokens/meta.json
#
# Learned versions and the lesson store live on the Fly volume at /data, so
# what the model learns survives restarts and redeploys.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# CPU wheels keep the image a few hundred MB instead of several GB of CUDA.
COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.4,<2.15" \
 && pip install -r /app/server/requirements.txt

COPY training/phase1/train.py /app/training/phase1/train.py
COPY training/phase2/sft.py /app/training/phase2/sft.py
COPY server/_paths.py server/modeling.py server/learning.py server/server.py /app/server/

ARG CKPT_SRC=out/anima-dpo/ckpt.pt
COPY ${CKPT_SRC} /app/model/ckpt.pt
COPY data/anima_tokens/tokenizer.json data/anima_tokens/meta.json /app/model/tokens/

ENV ANIMA_CKPT=/app/model/ckpt.pt \
    ANIMA_TOK_DIR=/app/model/tokens \
    ANIMA_LIVE_DIR=/data/live \
    ANIMA_HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# server.py refuses 0.0.0.0 without ANIMA_SERVER_TOKEN, so an unset secret
# fails loudly instead of serving (and teaching) an open model.
CMD ["python", "server/server.py"]
