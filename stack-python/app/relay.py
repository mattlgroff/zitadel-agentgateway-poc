import asyncio


async def copy(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    finally:
        writer.close()


async def proxy(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    try:
        server_reader, server_writer = await asyncio.open_connection("stack-python", 5000)
    except OSError:
        client_writer.close()
        return
    await asyncio.gather(
        copy(client_reader, server_writer),
        copy(server_reader, client_writer),
        return_exceptions=True,
    )


async def main() -> None:
    server = await asyncio.start_server(proxy, "0.0.0.0", 5000)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
