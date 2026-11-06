# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/doodo ./cmd/doodo

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/doodo /doodo
EXPOSE 8080
ENTRYPOINT ["/doodo"]
