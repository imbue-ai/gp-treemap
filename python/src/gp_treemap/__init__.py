"""Python wrapper around gp-treemap.

Typical usage::

    from gp_treemap import treemap
    fig = treemap(df, path=["continent", "country"], values="population")
    fig.write_html("out.html")
"""

from .api import Treemap, treemap

__all__ = ["treemap", "Treemap"]
__version__ = "0.6.1"
